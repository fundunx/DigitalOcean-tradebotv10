const http = require("http");
const fs = require("fs");
const path = require("path");

const WEB_ROOT = "/var/www/apexquant-v6/frontend";
const API_HOST = "127.0.0.1";
const API_PORT = 8094;

function contentType(file) {
  if (file.endsWith(".html")) return "text/html";
  if (file.endsWith(".js")) return "application/javascript";
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".json")) return "application/json";
  return "text/plain";
}

http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    const proxy = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers
    }, apiRes => {
      res.writeHead(apiRes.statusCode || 500, {
        ...apiRes.headers,
        "Access-Control-Allow-Origin": "*"
      });
      apiRes.pipe(res);
    });

    proxy.on("error", () => {
      res.writeHead(502, {"Content-Type":"application/json"});
      res.end(JSON.stringify({error:"Backend API not reachable"}));
    });

    req.pipe(proxy);
    return;
  }

  let filePath = path.join(WEB_ROOT, req.url === "/" ? "command-centre/index.html" : req.url);

  if (req.url.startsWith("/command-centre") && !path.extname(filePath)) {
    filePath = path.join(WEB_ROOT, "command-centre/index.html");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {"Content-Type": contentType(filePath)});
    res.end(data);
  });
}).listen(80, "0.0.0.0", () => {
  console.log("ApexQuant frontend proxy running on port 80");
});
