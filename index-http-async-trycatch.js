var http = require('http'),
    path = require('path');

http.createServer(function (request, response) {
    try {
        var f = function() {
            throw new Error("uh-oh");
            response.writeHead(200, {'Content-Type': 'text/plain'});
            response.end(path.basename(__filename) + ': Hello World\n');
        };
        setTimeout(f, 1000);
    } catch (ex) {
        response.writeHead(500, {'Content-Type': 'text/plain'});
        response.end(path.basename(__filename) + ': Error: ' + ex.message + '\n');
    }
}).listen(1025);

console.log('Server running at http://127.0.0.1:1025/');
