## Towards

# 100% Uptime

## with Node ##



![SpanishDict](img/sd-logo.png)

9M uniques / month.
<br>
<br>
![Fluencia](img/fluencia-logo.jpg)

60K+ users, some are paid subscribers.

Note: I'm a Software Engineer, one of three, at Curiosity Media. We have two main properties:
SpanishDict and Fluencia. Both run Node.js on the backend. SpanishDict is a traditional web site,
with page reloads. Fluencia is a single page web app with AJAX calls to a REST API. We want both to
run all the time, every day.



## ( **We** | **you** | **users** )
## **hate downtime.**

![Downtime](/img/platform-downtime.png)

Note:
Downtime is bad for all sorts of reasons.
Users go away.
If you know that deploying code can cause a bad experience for users who
are online, or cause system errors or corrupted data, you won't deploy as
much.



### Lots of things can cause downtime.

- Database.
- Network.
- Imperfect engineers (e.g., me).



### Preventing downtime takes
### planning and work.



### Important, but
## out of scope
### for this talk:

* Redundant infrastructure.
* Backups.
* Disaster recovery.



## In scope:

## Node
  * Domains.
  * Cluster module.
  * Express.

Note: Without further ado, here are the...



# Keys to 100% uptime


## 1. Sensibly handle unknown errors
### (i.e., uncaught exceptions).


## 2. Use domains to
## handle known errors.


## 3. Manage processes
## with cluster.


## 4. Gracefully terminate connections
#### (when needed).



## 1. Sensibly handle uncaught exceptions


### uncaught exceptions happen when:
- an exception is thrown but not caught
- an error event is emitted but nothing is listening for it


From node/lib/events.js:

```js
EventEmitter.prototype.emit = function(type) {
  // If there is no 'error' event listener then throw.
  if (type === 'error') {
      if (this.domain) {
      ...
      } else if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        throw TypeError('Uncaught, unspecified "error" event.');
      }
```


## An uncaught exception
## crashes the process.

This process might be a server.

It might be handling a bunch of requests
<br>
from different clients at any moment.

Crashing is bad.


## How can we recover from that?


### By the end, we will have a solution
### to handle this as well as possible.


## It starts with...



## Domains.
#### Use domains to handle known errors.


## Domains are a bit like
## `try/catch` for async.



From node/lib/events.js:

```js
EventEmitter.prototype.emit = function(type) {
  // If there is no 'error' event listener then throw.
  if (type === 'error') {
      if (this.domain) {  // This is important!
      ...
      } else if (er instanceof Error) {
        throw er;
      } else {
        throw TypeError('Uncaught, unspecified "error" event.');
      }
```



### Wrap async operations in a domain,
### and the domain will catch
### thrown exceptions and error events.



### Then what to do with the error
### is up to you.

* Ignore.
* Retry.
* Abort (e.g., return 500).
* Throw (becomes an unknown error).



### An error caught by a domain
### has a few extra fields:

* `error.domain`
* `error.domainEmitter`
* `error.domainBound`
* `error.domainThrown`

Note: Maybe useful for tracing errors and debugging.



### So I have to create a new domain everytime I do an async operation?

Like every time I handle a request / response cycle?



## You could.

That would work.



## Could use middleware.

More convenient.


### In Express, this might look like:

```js
var domainWrapper = function(req, res, next) {
  var reqDomain = domain.create();
  reqDomain.add(req);
  reqDomain.add(res);
  reqDomain.run(next);
  reqDomain.once('error', function(err) {
    next(err);
    reqDomain.dispose();
  });
};
```

<small>
Based on
<br />
https://github.com/brianc/node-domain-middleware
<br />
https://github.com/mathrawka/express-domain-errors
</small>

Note:
Let's step through this.
req and res are event emitters.
EEs can be explicitly added to a domain.
And when new EEs are created, they add themselves to the active domain.
When any EE emits an error, it propagates to the domain associated with that EE.

This middleware triggers Express error handling. Alternatively, you could just send a response like 500.

The once is tricky. Now we're in an error state, so more errors could be thrown. Do you want your
error handler triggered on all of them?
Dispose is also tricky. It tries to clean up. TODO more on this.

Of course, if the domain is disposed and an error occurs, then it will be
uncaught. TODO confirm this -- see example-domain.js
In general, be able to talk about dispose.



## Domain methods.
- `run`: run a function in context of domain.
- `bind`: bind one function.
- `intercept`: like bind but handles 1st arg `err`.
- `enter`/`exit`: internal plumbing &mdash; don't use!

<br />
`run` seems most generally useful.



# Domains
## are great
## until they're not.



### node-mongodb-native does not play well
### with `process.domain`.

```js
app.use(function(req, res, next) {
  console.log(process.domain); // a domain
  UserModel.findOne(function(err, doc) {
    console.log(process.domain); // undefined
    next();
  });
});
```

<small>
See https://github.com/LearnBoost/mongoose/pull/1337
</small>

Note:
So your callback better not throw any errors!
This is what Mongoose uses.
Going to open a Jira ticket.



### What other operations might trash `process.domain`?

Good question!

Afaik, this is an unsolved problem and an area of research.

Domains in v0.10 are "unstable".



### Can 100% uptime be achieved
### just using domains?

## No.

### Not if only one instance of your app is running.

Note: Which brings us to #3...



## 3. Manage processes
## with cluster.



## Cluster module.

Node = one thread per process.

Most machines have multiple CPUs.

One process per CPU = cluster.


## master / workers

* 1 master process forks `n` workers.
* Master and workers communicate state via IPC.
* When workers want to listen to a socket/server, master registers them for it.
* Each new connection to socket is handed off to a worker.
* No shared application state between workers.



### What happens when a worker isn't working anymore?

Some coordination is needed.


1. The worker needs to tell the cluster master it's done.

2. The master needs to know what to do: fork a replacement.

3. Master cannot wait for worker to die before forking a replacement.


### When a worker server can't accept new connections:

1. Worker tells cluster master it is disconnecting.
2. Worker disconnects from IPC channel.
3. Cluster master needs to fork new worker as soon as dying worker stops listening or disconnects from IPC
channel.
3. Worker needs to stay around to clean up in-flight requests gracefully.



## Deployment.

Another use case for cluster.

We want to replace all existing servers.

Something must manage that = cluster master process.


## Zero downtime deployment.

* Master process never stops running.

* Tell master location of new code: use a symlink, update symlink when deploy new code.

* Tell master when to reload workers by sending a signal.

* Master tells old workers to shut down gracefully, forks new workers from new code.


## Signals.
Signals are a UNIXy way
<br>
to communicate with running processes.
<br />
For example:

- `SIGHUP`: cycle workers (or `SIGUSR2`).
- `SIGINT`, `SIGQUIT`, `SIGTERM`: shut down gracefully.
- `SIGKILL`: shut down **now**.



## Process management options.


## Forever
https://github.com/nodejitsu/forever

- Has been around...forever.
- Runs as daemon, and runs your script as a daemon.
- No cluster awareness &mdash; used on master process.
- More comparable to Upstart or Monit.
- Lots of GH issues.


## Naught
https://github.com/superjoe30/naught

- Newer.
- Runs as daemon.
- Cluster aware.
- Can backoff respawns.
- Handles log compression, rotation.


## Recluster
https://github.com/doxout/recluster

- Newer.
- Cluster aware.
- Can backoff respawns.
- Simple, relatively easy to reason about.
- Log agnostic.


## We went with recluster.
### Happy so far.


Some of it may be reinventing the wheel.

I'm still learning the extent of what is going on in Node `child_process` and `cluster` modules.



#### We have been talking about
#### connecting / disconnecting
#### as if they are atomic.

### They're not.



## 4. Gracefully terminate connections
#### when needed.



## Don't kill a worker instantly.

Give it a grace period to shut down cleanly.


### When a server closes,
### need to clean up:
* In-flight requests.
* HTTP keep-alive TCP connections.



### Slightly Controversial?

If it is in such a bad state (e.g., db disconnected), bad things might happen to in-flight requests,
too.

I don't know of any way to recover from that. Interested in ideas.


More likely, if it's an application error, the other requests will be fine.


## Shut down keep-alive connections

HTTP defaults to keep-alive which keeps the underyling TCP connection open.

We want to close those TCP connections for our dying worker.


Revisit our middleware from earlier.

Add before and after hooks for cleanup.

```js
var domainWrapper = function(before, after) {
  return function(req, res, next) {
    var reqDomain = domain.create();
    res.locals._domain  = reqDomain;
    reqDomain.add(req);
    reqDomain.add(res);
    reqDomain.run(next);
    reqDomain.once('error', function(err) {
      if(before) before(err);  // Hook.
      next(err);
      if(after) after(err);  // Hook.
    });
  };
};
```



## How to cleanup?

Set keepalive timeouts to 1 so as soon there is activity,

they close right away.

For example:

https://github.com/mathrawka/express-graceful-exit



### Node will close server once server.close calls back
Then call `process.exit`.



### Set a timer.
If timeout period expires and server is still around, call `process.exit`.



### Let's review
# Ideal server

![unicorn](/img/rainbow_unicorn.gif)



## On provision / boot

- OS process manager (e.g., Upstart) starts node-app service.
- node-app service brings up cluster master.
- Cluster master forks new workers from symlink.
- Each worker creates an instance of node-app server.
- Each instance accepts connections.


## On deploy

- Point symlink to new version.
- Upstart `reload` command sends `SIGHUP` to cluster master.
- Cluster master tells workers to disconnect from IPC channel.
- Cluster master forks new workers from new version of code.
- Workers disconnect from IPC channel.
- Workers enter graceful shutdown state: close out TCP connections.
- Existing workers exit when all connections are closed, or after a
timeout.


## On known error

- node-app server catches it (error handler, or domain)
- node-app server returns 500 if error was triggered by request



## On unknown error
### (uncaught exception)

- ??



Back to where we started:
## 1. Sensibly handle unknown errors
### (i.e., uncaught exceptions)


## uncaught exceptions

We have minimized these by using domains.

But they can still happen.



Node docs say not to keep running on uncaught exceptions.

> An unhandled exception means your application &mdash; and by extension node.js
> itself &mdash; is in an undefined state. Blindly resuming means anything could
> happen.
>
> You have been warned.

<small>
http://nodejs.org/api/process.html#process_event_uncaughtexception
</small>



These are not errors that you have anticipated, so you don't have a response to them. If you keep
going, maybe things will be fine, maybe not impossible to predict.

This is a controversial topic. You can find lots of debate on Github and Stackoverflow about whether
it is possible to recover from an uncaught exception.

TODO links



### What to do?
### You're supposed to
### kill the instance!


First, log the error so you know what happened.


It's not so bad. We can do now it
with a minimum of trouble:


## On unknown error
## (uncaught exception)

- app logs the error.
- node-app server stops accepting new TCP connections (either by disconnecting from
master/worker IPC channel, or calling server.close).
- worker tells cluster master it is disconnecting, then disconnects.
- cluster master forks a replacement worker.
- server enters graceful shutdown state.
- worker process exits when all connections are closed (graceful), or after
a reasonable timeout period (hard exit).



### What about the response that killed the worker?

### How does the dying worker respond to it?

### Good question!



> People are also under the illusion that it is possible to trace back [an uncaught] exception to
> the http request that caused it...

<small>-felixge, https://github.com/joyent/node/issues/2582</small>

I've been going on about always returning a response.

You can't always do it. Yet.

Fortunately, with all these steps, it shouldn't happen often, and when it does,
it should be limited to one particular connection.



## Always return a response, even on error

Don't keep clients hanging. They can come back to bite you.

- Must *avoid not sending any response* because 1) user agent appears to hang
and 2) it might resend the bad request once the connection closes
and trigger another exception!



nginx: `proxy_next_upstream`
http://wiki.nginx.org/HttpProxyModule#proxy_next_upstream
- if *any* data has been sent, you're stuck to the upstream
- if the request caused this error that crashed the upstream, then this will
crash your next upstream, too



## Limitations

Must bump cluster master when:

* Upgrade Node
* Cluster master code changes
* Upstart script changes



### During timeout periods, might have:

* More than workers than CPUs
* Workers running different versions (old/new)

<br>
<br>
Should be brief. Probably preferable to downtime.



## A few tips


### Be able to produce errors on demand on your dev and staging servers.
(Disable this in production.)

Note: This is really helpful for debugging and testing. Make sure to both a sync
and an async version.


## Keep master simple.

It needs to run for a long time without being updated.



## The future.

I've been talking about:

```json
{
  "node": "~0.10.20",
  "express": "~3.4.0",
  "connect": "~2.9.0",
  "mongoose": "~3.6.18",
  "recluster": "=0.3.4"
}
```


## Things change.


## Node 0.11 / 0.12
For example, cluster module has some changes.



## cluster is 'experimental'
Zero downtime means working with unstable or experimental parts of Node!



## Good reading

* [Remove uncaught exception handler?](https://github.com/joyent/node/issues/2582)
* [Isaacs stands by killing on uncaught](http://blog.izs.me/post/65712662830/restart-node-js-servers-on-domain-errors-sensible-fud)
* [Domains don't incur performance hits compared to try catch](http://www.lighthouselogic.com/use-domain-dispose/#/using-a-new-domain-for-each-async-function-in-node/)
* [Rejected PR to add domains to Mongoose, with discussion](https://github.com/LearnBoost/mongoose/pull/1337)
* [Don't call enter / exit across async](http://stackoverflow.com/a/15244463/599258)
* [Comparison of naught and forever](https://s3.amazonaws.com/superjoe/temp/naught.html)
* [What's changing in cluster](http://strongloop.com/strongblog/whats-new-in-node-js-v0-12-cluster-round-robin-load-balancing/?utm_source=javascriptweekly&utm_medium=email)



If you thought this was interesting,

## We're hiring.

![Fluencia](img/fluencia-logo.jpg)

![SpanishDict](img/sd-logo.png)

[curiositymedia.theresumator.com](http://curiositymedia.theresumator.com/)


## Thanks!

* @williamjohnbert
* github.com/sandinmyjoints/muchtolearn
