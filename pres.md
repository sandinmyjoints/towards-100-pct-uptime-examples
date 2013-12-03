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
main properties: SpanishDict and Fluencia.



## (We|you|users) hate downtime.


TODO Why zero-downtime?

   - screenshot of nginx 503 gateway unreachable
   - screenshot of Chrome (pending) request

Note:
- If nginx can't talk to the app, can return 503, users might see it, or
  their browser might hang.
- If you know that deploying code can cause a bad experience for users who
  are online, or cause system errors or corrupted data, you won't deploy as
  much.



Need a more concrete reason?
## Pop quiz
### What happens when a client makes a request and the underlying tcp connection is closed without a response?

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



# Sensible error handling
## is key to 100% uptime


### Things that throw errors:
- an error event that is emitted when no one is listening for it
- async io


It's right in the source.

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


### async io:
##`try` / `catch` won't help you



## Always return a response, even on error



# Handling exceptions

* try / catch won't help you now
Notice that try / catch didn't really help.
** does not really help you with async.
** async is trouble: no response whenever it was async. Express default error handling will not help you here, either.


# Domains

This is where domains come in. Wrap async operations in a domain, and the domain
will handle whatever happens.

* With domains, can we *always* return a response?

* So, do I have to create a new domain everytime I do an async operation?? Everytime I handle a req/res?

* That would work. Or you can create one and pass it around. In express, maybe using res.locals.

TODO Question: is it possible to wrap all of Express in a domain?

* Still a lot of extra work to domain.bind or domain.intercept or domain.run every async operation.

* Afaik, this is an unsolved problem and an area of research. Domains in v0.10 are 2 - Unstable.

* So that's how to handle the inner layers of the onion: the individual node http server, ie, your app.

* Can you achieve zero-downtime with one instance of your app running? Use domains, return a 500 on every exception?

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

* Solution: next layer of onion: multiple workers. One per each CPU. One worker dies, but others are still alive.
** start on the inside and work our way out.


### Tip:
## Be able to produce an error on demand on your dev and staging servers.
(Disable it in production.)



# Our ideal server

TODO picture of unicorn or something


## on exception caught by express, or process uncaught exception:
   - Returns 500 if error was triggered by request
   - Must *avoid not sending any response* because 1) user agent appears to hang
     and 2) it will probably resend the bad request once the connection closes,
     thus triggering another exception!
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


## No downtime on deployment

TODO how to introduce this


# Deployment / upgrades

Note: Robust error handling got us pretty far.


## Our ideal server


## on provision / boot
   - OS process manager (e.g., Upstart) starts node-app service, which brings up
     cluster master, which forks new workers, which each create instances of
     node-app, which each accept connections, which transmit requests that
     receive responses.


## on deploy new version / SIGHUP:

   - upstart sends SIGHUP to cluster master process.
   - cluster master process tells existing workers to disconnect from IPC channel.
   - existing workers disconnect from IPC channel.
   - existing workers enter graceful_shutdown state: closes existing keep-alive
     long-running TPC connections.
   - cluster master forks new workers from new version of code.
   - existing workers exists when all connections are closed, or after a
     reasonable timeout period.

## on SIGTERM

## on SIGKILL

## on SIGUSR1 / debugger / repl



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



# Limitations

Need to bump cluster master when:

* Upgrade Node version
* Cluster master code changes
* Upstart / init.d script changes

TODO: Do other solutions handle these cases? What would it take to fix this?


# Future

I've been talking about:

```json
{
  "node": "=0.10.20",
  "express": "=3.4.0",
  "connect": "=2.9.0",
  "recluster": "=0.3.4"
}
```


# Things change


## Node 0.11 / 0.12
This may all be changing in the future. Node 0.11 has round robin, add/remove worker.


## cluster is marked as experimental
Zero downtime means working with unstable and experimental parts of Node!



# Good reading

* https://github.com/mathrawka/express-graceful-exit
* http://strongloop.com/strongblog/whats-new-in-node-js-v0-12-cluster-round-robin-load-balancing/?utm_source=javascriptweekly&utm_medium=email



Want to get even closer to 100% uptime?

# We're hiring.

Come talk to me.

* @williamjohnbert
* github.com/sandinmyjoints
