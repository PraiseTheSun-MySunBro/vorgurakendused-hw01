"use strict";

const app = require("express")();
const http = require("http").Server(app);
const io = require("socket.io")(http);

var hosts = [];

app.get("/hosts", function(req, res) {
  res.send(hosts);
});

http.listen(3000, function() {
  console.log("listening on *:3000");
});

io.on("connection", function(socket) {
  const address = socket.handshake.address;
  const ipAddress = address.substring(address.lastIndexOf(':') + 1, address.length);
  const port = socket.handshake.query.port;
  hosts.push({ip: ipAddress, port: port});

  console.log(`A machine with ${ipAddress}:${port} successfully connected!`);
  socket.join("hosts");
  console.log(`A machine successfully joined!`);
  socket.emit("hosts", hosts);
  // socket.broadcast.to("hosts").emit("hosts", hosts);

  socket.on("disconnect", function() {
    console.log(`A machine with ${ipAddress}:${port} successfully disconnected!`);
    hosts = hosts.filter(item => item.ip !== ipAddress || item.port !== port);
    // socket.broadcast.to("hosts").emit("hosts", hosts);
  });
});

// setInterval(() => {
//   io.to("hosts").emit("hosts", hosts);
// }, 5000)
