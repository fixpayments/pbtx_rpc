'use strict';

const express = require('express');
require('dotenv-defaults').config();
const protobuf = require('protobufjs');
var hash = require('hash.js');

const required_options = ['PORT', 'BINDADDR', 'URL_PATH', 'NETWORK_ID', 'ANTELOPE_RPC', 'ANTELOPE_CONTRACT',
                          'ANTELOPE_ADMIN', 'ANTELOPE_ADMIN_PK', 'ANTELOPE_WORKER', 'ANTELOPE_WORKER_PK'];


for (const opt of required_options) {
    if( process.env[opt] === undefined ) {
        console.error(`Environment option ${opt} is not defined`);
        process.exit(1);
    }
}

protobuf.load('pbtx-rpc.proto', function(err, root) {
    if (err) {
        console.error('Cannot load proto file: ' + err);
        process.exit(1);
    }
});


const app = express();

app.use(function (req, res, next) {
    if( ! req.is('application/octet-stream') ) {
        throw new Error('Expected application/octet-stream');
    }
    next();
});

app.use(express.raw());

app.use(function (req, res, next) {
    req.sha256digest = hash.sha256().update(req.body()).digest();
    next();
});


app.post(process.env.URL_PATH + '/register_account', (req, res) => {
    var RegisterAccount = protobuf.Root().lookupType('pbtxrpc.RegisterAccount');
    var msg = RegisterAccount.decodeDelimited(req.body());
    console.log(msg);
})



app.listen(process.env.PORT, process.env.BINDADDR, () => {
    console.log(`Server is running at http://${process.env.BINDADDR}:${process.env.PORT}`);
});
