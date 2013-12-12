## Towards

# 100% Uptime

## with Node ##



A guy is standing on the corner of the street smoking one cigarette after another.

A lady walking by notices him and says,
"Hey, don't you know that those things can kill you? I mean, didn't you see the giant warning on the
box?!"

"That's OK," says the guy, puffing casually. "I'm a computer programmer."

"So? What's that got to do with anything?"

"We don't care about warnings. We only care about errors."

<small>
http://stackoverflow.com/a/235307/599258
</small>


<img src='img/sd-logo.png' alt="SpanishDict" style="width: 500px; height: 85px">

9M uniques / month.
<br>
<br>
![Fluencia](img/fluencia-logo.jpg)

75K+ users, some are paid subscribers.

Note:
I'm a Software Engineer, one of three, at Curiosity Media.
We have two main properties:
SpanishDict and Fluencia.
SpanishDict is a traditional web site, with page reloads.
Fluencia is a single page web app with AJAX calls to a REST API. We want both to
run all the time, every day.
Both run Node.js on the backend.



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



### Important, but
## out of scope
### for this talk:

* Redundant infrastructure.
* Backups.
* Disaster recovery.



## In scope:

* Application errors.
* Deploys.
* Node.js stuff:
  * Domains.
  * Cluster module.
  * Express.

Note: Without further ado, here are the...



# Keys to 100% uptime.


## 1. Sensibly handle unknown errors
### (i.e., uncaught exceptions).


## 2. Use domains to
## handle known errors.


## 3. Manage processes
## with cluster.


## 4. Gracefully terminate connections
#### (when needed).



## 1. Sensibly handle uncaught exceptions.


### Uncaught exceptions happen when:
- An exception is thrown but not caught.
- An error event is emitted but nothing is listening for it.


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

Note: If you're not listening for it, what will an uncaught thrown error do?


## An uncaught exception
## crashes the process.

This process might be a server.

It might be handling a bunch of requests
<br>
from different clients at the moment it crashes.


## How can we recover from that?

### By the end, we'll hopefully be able
### to handle this as well as possible.


## It starts with...



## Domains.
#### Use domains to handle known errors.


## Domains are a bit like
## `try/catch` for async.


### Wrap async operations in a domain,
### and the domain will catch
### thrown exceptions and error events.

The active domain is in `process.domain`

Note: If a domain is active when an EE is created, it will associate itself with that domain. What
does that mean?


From node/lib/events.js:

```js
EventEmitter.prototype.emit = function(type) {
  if (type === 'error') {
      if (this.domain) {  // This is important!
        ...
        this.domain.emit('error', er);
      } else if ...
```

Note: If the EE has an associated domain, the error will be emitted on the domain instead of thrown.
This right here can prevent a whole bunch of uncaught exceptions, thus saving your server processes.


### Then what to do with the error
### is up to you.

* Ignore.
* Retry.
* Abort (e.g., return 500).
* Throw (becomes an unknown error).



### An error caught by a domain
### has extra fields that
### can help with debugging:

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
    reqDomain.dispose();
    next(err);
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
req and res are both EEs. They were created before this domain existed, but
EEs can be explicitly added to a domain.
Then we run the rest of the req / res stack through the context of the domain,
and when new EEs are created, they add themselves to the active domain.
When any EE emits an error, it propagates to the domain associated with that EE.

This middleware triggers error handling middlewarwe. Alternatively, you could just send a response
like 500.


`domain.dispose`

The once is tricky. Now we're in an error state, so more errors could be thrown. Do you want your
error handler triggered on all of them?

Dispose is also tricky. It tries to clean up. TODO more on this.

Of course, if the domain is disposed and an error occurs, then it will be
uncaught.

TODO confirm this -- see example-domain.js
In general, be able to talk about dispose.



## Domain methods.
- `run`: run a function in context of domain.
- `bind`: bind one function.
- `intercept`: like bind but handles 1st arg `err`.
- (`enter`/`exit`: internal plumbing &mdash; don't use!)

<br />
`run` seems most generally useful.



# Domains
## are great
## until they're not.

Note: For example,



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


### Use explicit binding.

```js
app.use(function(req, res, next) {
  console.log(process.domain); // a domain
  AppModel.findOne(process.domain.bind(function(err, doc) {
    console.log(process.domain); // still a domain
    next();
  }));
});
```



### What other operations
### don't play well with `process.domain`?

Good question!

I don't have the answer.

I've opened a ticket with node-mongodb-native to find out more.


### Can 100% uptime be achieved
### just using domains?

## No.

### Not if only one instance of your app is running.

Note: When that instance is down, or restarting, it's unavailable. And if it goes down hard, any
in-flight requests when are toast. Some operations can still trigger uncaught exceptions. Or just
because an error is caught by a domain doesn't mean you can always keep going. You might not be in a
state that you can recover from. It might be safer to let this process die -- but what then? What
about the time between when this process dies and its successor comes up?

This brings us to #3...



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

#### (Perhaps because of an uncaught exception.)

### Some coordination is needed.


* Worker needs to tell cluster master it's done, and stop accepting new connections.

* Cluster master needs to fork a replacement.

* Worker needs to stay around to clean up in-flight requests gracefully.

* So, master cannot wait for worker to die before forking a replacement.



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
A way to communicate with running processes.

- `SIGHUP`: cycle workers (or `SIGUSR2`).
- `SIGINT`, `SIGQUIT`, `SIGTERM`: shut down gracefully.
- `SIGKILL`: shut down **now**.



## Process management options.


## Forever
https://github.com/nodejitsu/forever

- Has been around...forever.
- No cluster awareness &mdash; used on a single process.
- Simply restarts the process when it dies.
- More comparable to Upstart or Monit.
- Lots of GH issues.


## Naught
https://github.com/superjoe30/naught

- Newer.
- Cluster aware.
- Can backoff respawns.
- TODO what else
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


Some of what these modules do may be reinventing the wheel.

I'm still learning the extent of what is going on in Node's `child_process` and `cluster` modules.



#### We have been talking about
#### connecting / disconnecting
#### as if they are atomic.

### They're not.



## 4. Gracefully terminate connections
#### when needed.



## Don't kill a worker instantly.

Give it a grace period to do clean up.


### When a server closes,
### need to clean up:
* In-flight requests.
* HTTP keep-alive (open TCP) connections.



### Slightly Controversial?

If it is in such a bad state (e.g., db disconnected), bad things might happen to in-flight requests,
too.

I don't know of any way to recover from that. Interested in ideas.

More likely, if it's an application error, the other requests will be fine.



### How to clean up
Revisiting our middleware from earlier:

Add before and after hooks for cleanup.

```js
var domainWrapper = function(before, after) {
  return function(req, res, next) {
    var reqDomain = domain.create();
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


Use hooks to
## Shut down keep-alive connections.

HTTP defaults to keep-alive which keeps the underyling TCP connection open.

We want to close those TCP connections for our dying worker.

Set keepalive timeouts to 1 so as soon there is activity,
they close right away.

TODO: Example code from:
https://github.com/mathrawka/express-graceful-exit



And
## call `server.close`
To wait until existing connections are closed.



### Node will close server once server.close calls back
meaning all connections are closed.

Then call `process.exit`.



### Set a timer.
If timeout period expires and server is still around, call `process.exit`.



### Review:
## Our ideal server.

![unicorn](/img/rainbow_unicorn.gif)



## On boot:

- OS process manager (e.g., Upstart) starts node-app service.
- node-app service brings up cluster master.
- Cluster master forks new workers from symlink.
- Each worker creates an instance of node-app server.
- Each instance accepts connections.


## On deploy:

- Point symlink to new version.
- Upstart `reload` command sends `SIGHUP` to cluster master.
- Cluster master tells workers to disconnect from IPC channel.
- Cluster master forks new workers from new version of code.
- Workers disconnect from IPC channel.
- Workers enter graceful shutdown state: close out TCP connections.
- Existing workers exit when all connections are closed, or after a
timeout.


## On known error:

- node-app server catches it (via error handler or domain).
- node-app server returns 500 if error was triggered by request.



## On unknown error:
### (uncaught exception)

- ??

```js
process.on('uncaughtException', function(err) {
  // ??
})
```



Back to where we started:
## 1. Sensibly handle unknown errors
### (i.e., uncaught exceptions)


## Uncaught exceptions happen.

We have minimized these by using domains.

But they can still happen.



Node docs say not to keep running on uncaught exceptions.

> An unhandled exception means your application &mdash; and by extension node.js
> itself &mdash; is in an undefined state. Blindly resuming means anything could
> happen.
> You have been warned.
> <footer>
> <cite>
> <small>
> http://nodejs.org/api/process.html#process_event_uncaughtexception
> </small>
> </cite>
> </footer>



### What to do?
First, log the error so you know what happened.


### Then, you're supposed to
### kill the process.

Node doesn't separate your application from the server.

With power comes responsibility.



It's not so bad. We can do now it
with a minimum of trouble:


## On unknown error
## (uncaught exception)

- app logs the error.
- server stops accepting new connections (either by disconnecting from
master/worker IPC channel, or calling `server.close`).
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
>
> <footer><cite>
> <small>-felixge, https://github.com/joyent/node/issues/2582</small>
> </cite></footer>



### This is too bad, because you want to
### always return a response, even on error.

Keeping a client hanging can come back to bite you.

Note: 1) user agent appears to hang and 2) it might resend the bad request once the connection
closes and trigger another exception!



It's in the HTTP spec.

Note: I've seen this happen. It's not pretty. Can crash multiple workers.

This presentation was originally titled "I Have Much to Learn About Node.js".

It's still titled "Toward 100% Uptime" because I can't guarantee it. But then, who can?



### Fortunately, given what we've discussed,
### it shouldn't happen often.

### And when it does, it should be limited
### to one particular connection.



## Limitations.

Must bump cluster master when:

* Upgrade Node.
* Cluster master code changes.
* Upstart script changes.



### During timeout periods, might have:

* More than workers than CPUs.
* Workers running different versions (old/new).

<br>
Should be brief. Probably preferable to downtime.



## A few tips.


### Be able to produce errors on demand on your dev and staging servers.
(Disable this in production.)

Note: This is really helpful for debugging and testing. Make sure to both a sync
and an async version.


## Keep master simple.

It needs to run for a long time without being updated.



## Things change.

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


## The Future: Node 0.11 / 0.12
For example, cluster module has some changes.



## Cluster is 'experimental'.
## Domains are 'unstable'.
Zero downtime means working with unstable or experimental parts of Node!
TODO image of volcano



## Good reading:

* [Node.js Best Practice Exception Handling](http://stackoverflow.com/questions/7310521/node-js-best-practice-exception-handling)
  (some answers more helpful than others)
* [Remove uncaught exception handler?](https://github.com/joyent/node/issues/2582)
* [Isaacs stands by killing on uncaught](http://blog.izs.me/post/65712662830/restart-node-js-servers-on-domain-errors-sensible-fud)
* [Domains don't incur performance hits compared to try catch](http://www.lighthouselogic.com/use-domain-dispose/#/using-a-new-domain-for-each-async-function-in-node/)
* [Rejected PR to add domains to Mongoose, with discussion](https://github.com/LearnBoost/mongoose/pull/1337)
* [Don't call enter / exit across async](http://stackoverflow.com/a/15244463/599258)
* [Comparison of naught and forever](https://s3.amazonaws.com/superjoe/temp/naught.html)
* [What's changing in cluster](http://strongloop.com/strongblog/whats-new-in-node-js-v0-12-cluster-round-robin-load-balancing/?utm_source=javascriptweekly&utm_medium=email)



If you thought this was interesting,

## We're hiring.

[curiositymedia.theresumator.com](http://curiositymedia.theresumator.com/)

![Fluencia](img/fluencia-logo.jpg)

<img src='img/sd-logo.png' alt="SpanishDict" style="width: 500px; height: 85px">



## Thanks!

* @williamjohnbert
* github.com/sandinmyjoints/muchtolearn
