"use strict";

const io = require('socket.io-client');
const app = require('express')();
const http = require('http')
const server = http.Server(app);
const request = require('request');
const axios = require('axios');
const bodyParser = require('body-parser')
const EventEmitter = require('events');

class MyEmitter extends EventEmitter {};
const event = new MyEmitter();

app.use(bodyParser.urlencoded({ extended: true}));
app.use(bodyParser.json())

const states = {"REQUEST": 1, "SEND": 2, "DOWNLOAD": 3, "FINISH": 4};
const errorCodes = {"NOT_ACCEPTABLE": "NOT ACCEPTABLE", "OK": "OK"};
const args = process.argv;

const myIpAddress = "127.0.0.1"
const myPort = args[2] || 4500;

const serverAddress = "127.0.0.1";
const serverPort = 3000;
const socket = io(`http://${serverAddress}:${serverPort}/`, {
  query: `port=${myPort}`
});

const laziness = 0.5;

var hosts = [];
var requests = {};

server.listen(myPort, myIpAddress, () => {
  console.log(`Listening ${myIpAddress}:${myPort}`);
});

socket.on("hosts", data => {
  //console.log("Received data: ", data)
  hosts = data;
});

app.get("/download", (req, res) => {
  const id = req.query.id;
  const url = req.query.url;
  const ip = req.connection.remoteAddress;
  const port = req.query.port;
  
  if (id == null || url == null || ip == null || port == null) {
    res.sendStatus(404);
    return;
  }
  if (requests[id] != null) {
    res.status(200).send(errorCodes.NOT_ACCEPTABLE);
    return;
  }
  console.log(`Downloading URL: ${url} with ID: ${id}`);

  requests[id] = {
    ip: ip,
    port: port,
    url: url,
    host: false,
    state: states.REQUEST
  }

  event.emit('check', id);
  res.sendStatus(200);
});

app.get('/check', (req, res) => {
  let id = req.query.id;

  res.sendStatus(requests[id] != null && requests[id].state != states.REQUEST ? 200 : 204);
});

app.post('/file', (req, res) => {
  const id = req.query.id;
  console.log('File request');
  
  if (requests[id] == null || requests[id].state === states.FINISH) {
    res.status(200).send(errorCodes.NOT_ACCEPTABLE);
    return;
  }

  if (requests[id].host) {
    requests[id].state = states.FINISH;
    console.log('StatusCode: ', req.body.status);
    console.log('Mime-type: ', req.body['mime-type']);
    console.log("Content: ", Buffer.from(req.body.content, "base64").toString("ascii"));
  } else {
    console.log('Sending back to host');
    event.emit("sendBackToHost", id, req.body);
  }

  res.sendStatus(200);
});

event.on('check', (id) => {
  axios.get(`http://${requests[id].ip}:${requests[id].port}/check?id=${id}`)
    .then(res => {
      if (res.status === 204) {
        requests[id].url = encodeUrl(requests[id].url);
        requests[id].host = true;
        event.emit('sendNext', id);
      } else if (res.status === 200)
        event.emit('downloadOrSend', id);
    })
    .catch(err => {
      console.error('Error with checking', err);
    })
});

event.on('downloadOrSend', (id) => {
  if (isDownloadState()) {
    axios.get(decodeUrl(requests[id].url))
      .then(res => {
        const body = {
          content: Buffer.from(res.data).toString('base64'),
          status: res.status,
          "mime-type": res.headers["content-type"]
        };
        
        requests[id].state = states.DOWNLOAD;
        event.emit('sendBackToHost', id, body)
      })
      .catch(err => {
        console.error('Error while downloading file', err.response);
      })
    return;
  }
  event.emit('sendNext', id);
})

event.on('sendBackToHost', (id, body) => {
  axios.post(`http://${requests[id].ip}:${requests[id].port}/file?id=${id}`, body)
    .catch(err => {
      console.error("Error while sending back to host", err.response);
      event.emit('sendFileBackToAll', id, body);
    });
});

event.on('sendNext', (id) => {
  requests[id].state = states.SEND;
  for (let h of hosts) {
    if (h.ip == requests[id].ip && h.port == requests[id].port) continue;
    if (h.ip == myIpAddress && h.port == myPort) continue;

    axios.get(`http://${h.ip}:${h.port}/download?id=${id}&url=${requests[id].url}&port=${myPort}`)
      .catch(err => {
        console.error('Error while sending requests to neighbours', err.response);
      });
  }
});

event.on('sendFileBackToAll', (id, body) => {
  for (let h of hosts) {
    if (h.ip == myIpAddress && h.port == myPort) continue;
    
    axios.post(`http://${h.ip}:${h.port}/file?id=${id}`, body)
      .catch(err => {
        console.error("Error while sending back to all hosts", err.response);
      });
  }
});

function isDownloadState() {
  return Math.random() >= laziness;
}

function encodeUrl(url) {
  return (decodeURIComponent(url) === url) ? encodeURIComponent(url) : url;
}

function decodeUrl(url) {
  return (decodeURIComponent(url) === url) ? url : decodeURIComponent(url);
}

setInterval(() => {
  axios.get(`http://${serverAddress}:${serverPort}/hosts`)
    .then(res => {
      hosts = res.data;
    })
    .catch(err => {
      console.error("Error while fetching data from server", err.response);
    })
}, 60000)
