domain = require('domain');

var d = domain.create();
d.on('error', function (err) {
  console.log("domain caught", err);
});
console.log(domain.active); // null
var f = d.bind(function() {
  console.log("active domain", domain.active);
  console.log(domain.active === d);
  console.log(domain.active === process.domain);
  throw new Error("uh-oh");
});
setTimeout(f, 1000);
