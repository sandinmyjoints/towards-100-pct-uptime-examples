## Towards

# 100% Uptime

## with node.js ##



# SpanishDict

9M uniques / month
<br>
<br>
# Fluencia

60K+ users, some are paid subscribers

Note: I'm a Software Engineer, one of three, at Curiosity Media. We have two
main properties: SpanishDict and Fluencia. Both run Node.js on the backend.
SpanishDict is a traditional web site, with page reloads. Fluencia is a single
page web app with AJAX calls to a REST API.



## ( We | you | users )
## hate downtime.


TODO Why zero-downtime?

![no response](img/no-response.png)

   - screenshot of nginx 503 or 502 gateway unreachable / upstream timed out
   - screenshot of Chrome (pending) request

Note:
- If nginx can't talk to the app, can return 503, users might see it, or
  their browser might hang.
- If you know that deploying code can cause a bad experience for users who
  are online, or cause system errors or corrupted data, you won't deploy as
  much.



# Lots of things want to cause downtime

- database
- network
- less than perfect engineers (know any?)



# It's us vs real world (and ourselves!)



# Keys to 100% uptime


## 1. Sensibly handle unknown errors
### (i.e., uncaught exceptions)


## 2. Use domains to handle known errors


## 3. Gracefully terminate connections
#### (when needed)


## 4. Manage processes with cluster
#### with a little help from friends



# 1. Sensibly handle uncaught exceptions


### uncaught exceptions happen when:
- an error event that is emitted when no one is listening for it
- async io


It's right in the source. From node/lib/events.js:

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


# an uncaught exception crashes the process

This process might be a server.

It might be handling a bunch of requests from different clients at this moment.

It might have a bunch more clients keeping TCP connections open ready to send
their next request.


# How can we recover from that?


# We will work through what to do to recover from that


# By the end, we will have a solution to handle that as well as possible


# It starts with...



# Domains



## domains are like `try / catch` for async

Note: async can be trouble: no response whenever it was async. Express default error
handling will not help you here, either.



# async is tricky

Note: Wrap async operations in a domain, and the domain will handle whatever
happens: exception, error event emitted.



# So, do I have to create a new domain everytime I do an async operation?

Everytime I handle a req/res?



# You could.

That would work.



# Use middleware.

More convenient.


## In Express, this might look like:

```js
var domainWrapper = function(req, res, next) {
  var reqDomain = domain.create();
  reqDomain.add(req);
  reqDomain.add(res);
  reqDomain.run(next);
  reqDomain.once('error', function(err) {
    next(err);
  });
};
```

<small>
Based on
* https://github.com/brianc/node-domain-middleware.
* https://github.com/mathrawka/express-domain-errors
</small>

Note: Triggers Express error handling. Your error handler can send a response.



Of course, if the domain is disposed and an error occurs, then it will be
uncaught. TODO confirm this -- see example-domain.js
In general, be able to talk about dispose.



## domain methods
  - `enter`
  - `bind`
  - `run`
  - `intercept`


## domain methods
  - `enter`
  - `bind`
  - `run`
  - `intercept`

Slightly different semantics.

`run` seems most generally useful.



# domains
## are great
## until they're not



## Can you achieve zero-downtime with one instance of your app running?
Use domains, return a 500 on every exception?


## Can you achieve zero-downtime with one instance of your app running?
Use domains, return a 500 on every exception?

# No.



## node-mongodb-native (and thus Mongoose) does not respect `process.domain`

```js
app.use(function(req, res, next) {
  console.log(process.domain); // a domain
  UserModel.findOne({field: value}, function(err, doc) {
    console.log(process.domain); // undefined
    next();
  });
});
```

See https://github.com/LearnBoost/mongoose/pull/1337

Going to open a Jira ticket



# How to know what other operations might be unsafe?

Good question!

Afaik, this is an unsolved problem and an area of research. Domains in v0.10 are
"unstable".



# Domains don't get us all the way there


# Domains don't get us all the way there


(Deployment is another thing domains don't help with.)



## 3. Manage processes with cluster
#### with a little help from friends



# cluster module

Node = one thread per process.

Most machines have multiple CPUs.

One process per CPU = cluster.


# master / workers

* 1 master process forks `n` workers
* When workers want to listen to a socket/server, master either creates it for
  them or registers them for it
* Each new connection to socket is handed off to a worker
* Master and workers communicate state via IPC
* No shared application state between workers



# What happens when a worker isn't working anymore?

The node docs have nice examples but they are not robust

You have to coordinate
worker server closes
worker disconnects from ipc channel

Need to handle a worker disconnect

Worker stays around to clean up gracefully

Fork new worker as soon as dying worker stops listening or disconnects from IPC
channel

If it disconnects from IPC channel, master will know

But if worker just stops listening on server/socket, it needs to communicate that to master

master cannot wait for worker to die before forking a replacement



# Deployment

Another consideration

By definition, want to replace all existing servers

Something must manage that = master


# Zero downtime deployment

master process never stops running
tell master location of new code
master forks new workers from new code



# Process management choices


## Forever
   - Has been around...forever
   - Lots of issues
   - No cluster
   - TODO Does it play well with upstart?
   - TODO daemon?


## Naught
   - Newer
   - Cluster
   - Handles logging too (!)
   - TODO Does it play well with upstart?
   - runs its own daemon


## Recluster
   - Newer
   - Cluster
   - Simple
   - Log agnostic
   - Relatively easy to reason about


## Went with recluster.
### Happy so far.


Some of it may be reinventing the wheel.

Still learning all of what is going on in Node child_prcess and cluster modules.



## Signals
Side note. Several things you can communicate to your running server.

   - `SIGTERM`: shut down gracefully
   - `SIGKILL`: shut down **now**
   - `SIGUSR1`: start debugger / repl
   - `SIGUSR2`: some people like this for reload / new version



# In-flight

We have been talking about connecting / disconnectin like these are atomic
things, but it's not.

* in-flight requests
* HTTP keep-alive TCP connections


## 4. Gracefully terminate connections
#### when needed

## Don't kill a worker instantly

Give it a grace period to shut down cleanly.

Controversial: if it is in such a bad state (e.g., db disconnected), bad things
might happen to in-flight requests, too. I don't know of any way to recover from
that. Interested in ideas.

More likely, if it's a simple application error, the other requests will be
fine.


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
      if(before) before(err);
      next(err);
      if(after) after(err);
    });
  };
};
```

How to cleanup?

* https://github.com/mathrawka/express-graceful-exit

Set keepalive timeouts to zero TODO verify
TODO figure out what else





nginx: `proxy_next_upstream`
http://wiki.nginx.org/HttpProxyModule#proxy_next_upstream
 - if *any* data has been sent, you're stuck to the upstream
 - if the request caused this error that crashed the upstream, then this will
   crash your next upstream, too


## Always return a response, even on error

Don't keep clients hanging. They can come back to bite you.


# Real world example


- Bursts of errors in application log
- What is happening?


### What happens when
### a client makes a request
### and the underlying tcp connection
### is closed without a response?

Note:
- If errors aren't handled correctly, user agents may resend bad requests
  and cause even more trouble.


The client will open a new connection and retry.

This is in the HTTP spec.


### Question 2
## What do the Node docs say to do on an uncaught exception?


Kill the process.


So what happens when I POST a charge to /api/billing and something goes
wrong and the server throws?


If no other workers, maybe nothing happens -- maybe error while waiting for
a new worker to come up.


If using cluster, then
  - another POST! maybe repeating a charge, if that part went through? who knows!

TODO: demo this


No response is a big problem for clients, and for us
  - seems to hang, and some clients will resend the request multiple times,
    possibly triggering some error on more workers if you are using workers.



If I had known the 4 keys to uptime



# Revisit uncaught exceptions


## 1. Sensibly handle unknown errors
### (i.e., uncaught exceptions)


# uncaught exceptions

We have minimized these by using domains. But they can still happen.

By definition, you don't know what happened.

** Node docs say not to keep running on uncaught exceptions:

  - http://nodejs.org/api/process.html#process_event_uncaughtexception:

    Do not use it as the node.js equivalent of On Error Resume Next. An
    unhandled exception means your application - and by extension node.js
    itself - is in an undefined state. Blindly resuming means anything could
    happen.

    Think of resuming as pulling the power cord when you are upgrading your
    system. Nine out of ten times nothing happens - but the 10th time, your
    system is bust.

    You have been warned.

  - These are not errors that you have anticipated, so you don't have a
    response to them. If you keep going, maybe things will be fine, maybe not
    -- impossible to predict?

  - Do you feel lucky?
** Izaacs stands by this: http://blog.izs.me/post/65712662830/restart-node-js-servers-on-domain-errors-sensible-fud

* So what are you supposed to do? You are supposed to kill this instance != zero downtime

But now, we can do that with a minimum of trouble:

* an individual worker stops accepting new connections
* cluster master spins up a new worker to replace it
* dying worker gracefully closes existing connections, then dies


# But what about the dying worker?

I've been dishonest

going on about always returning a response

Still don't really know how to return a response for the req / res your uncaught exception
handler is triggered on

The other in-flight ones all get gracefully handled

But what about this one?

Fortunately, with all these steps, it shouldn't happen often, and when it does,
it should be limited to one particular connection

# Our ideal server

TODO picture of unicorn or something


## On provision / boot

   - OS process manager (e.g., Upstart) starts node-app service.
   - node-app brings up cluster master.
   - Cluster master forks new workers.
   - Each worker creates an instance of node-app.
   - Each instance accepts connections.


## On deploy new version / SIGHUP:

   - Upstart sends `SIGHUP` to cluster master.
   - Cluster master tells workers to disconnect from IPC channel.
   - Workers disconnect from IPC channel.
   - Workers enter graceful_shutdown state: close out TCP connections.
   - Cluster master forks new workers from new version of code.
   - Existing workers exit when all connections are closed, or after a
     timeout.


## On error

 - Returns 500 if error was triggered by request
 - Must *avoid not sending any response* because 1) user agent appears to hang
   and 2) it might resend the bad request once the connection closes
   and trigger another exception!
 - stops accepting new TCP connections (either by disconnecting from
   master/worker IPC channel, or calling server.close)
 - worker enters graceful_shutdown state: closes existing keep-alive
   long-running TCP connections (sets timeout to 1 whenever there is activity
   on them so they close right away)
 - worker process exits when all connections are closed (graceful), or after
   a reasonable timeout period (hard exit)
 - cluster master forks a replacement worker either once old worker dies
   (easy) or once it stops accepting new TCP connections (how to know? either
   disconnects, or maybe just server closes, in which case it needs to tell
   cluster master). In that case, can have > n workers, where n is number of
   CPUs -- not ideal, but probably not a problem unless a bad worker is
   maxing out resources.


# Limitations

Must bump cluster master when:

* Upgrade Node
* Cluster master code changes
* Upstart script changes

TODO: Do other solutions handle these cases? What would it take to fix this?



### Tip:
## Be able to produce an error on demand on your dev and staging servers.
(Disable it in production.)

Note: This is really helpful for debugging and testing. Make sure to both a sync
and an async version.



# Future

I've been talking about:

```json
{
  "node": "~0.10.20",
  "express": "~3.4.0",
  "connect": "~2.9.0",
  "recluster": "=0.3.4",
  "mongoose":
}
```


# Things change


## Node 0.11 / 0.12
This may all be changing in the future. Node 0.11 has round robin, add/remove worker.
TODO: Node 0.11 domains


## cluster is "experimental"
Zero downtime means working with unstable and experimental parts of Node!



# Good reading

* https://github.com/mathrawka/express-graceful-exit
* http://strongloop.com/strongblog/whats-new-in-node-js-v0-12-cluster-round-robin-load-balancing/?utm_source=javascriptweekly&utm_medium=email
* [Domains don't incur performance hits compared to try catch](http://www.lighthouselogic.com/use-domain-dispose/#/using-a-new-domain-for-each-async-function-in-node/)
* [Rejected PR to add domains to Mongoose, with discussion](https://github.com/LearnBoost/mongoose/pull/1337)

Want to get even closer to 100% uptime?

# We're hiring.

Come talk to me.

* @williamjohnbert
* github.com/sandinmyjoints
