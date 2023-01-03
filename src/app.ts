import express from 'express';

import dotenv from 'dotenv-defaults';
dotenv.config();

import protobuf from 'protobufjs';
import hash from 'hash.js';



const required_options = ['PORT', 'BINDADDR', 'URL_PATH', 'NETWORK_ID', 'ANTELOPE_RPC', 'ANTELOPE_CONTRACT',
                          'ANTELOPE_ADMIN', 'ANTELOPE_ADMIN_PK', 'ANTELOPE_WORKER', 'ANTELOPE_WORKER_PK'];


for (const opt of required_options) {
    if( process.env[opt] === undefined ) {
        console.error(`Environment option ${opt} is not defined`);
        process.exit(1);
    }
}

let rpc_root = protobuf.loadSync('pbtx-rpc.proto').root;

const app = express();

app.use(function (req, res, next) {
    if( ! req.is('application/octet-stream') ) {
        throw new Error(`Expected application/octet-stream, got ${req.get('Content-Type')}`);
    }
    next();
});

app.use(express.raw());

app.use(function (req, res, next) {
    req.sha256digest = hash.sha256().update(req.body).digest();
    next();
});


app.post(process.env.URL_PATH + '/register_account', (req, res) => {
    var RegisterAccount = rpc_root.lookupType('pbtxrpc.RegisterAccount');
    var msg = RegisterAccount.decodeDelimited(req.body);
    console.log(JSON.stringify(msg));

    let RegisterAccountResponse = rpc_root.lookupType('pbtxrpc.RegisterAccountResponse');
    let resp_msg = RegisterAccountResponse.create({
        requestHash: req.sha256digest,
        status: rpc_root.lookupEnum('pbtxrpc.RegisterAccountResponse.StatusCode').values.SUCCESS,
        networkId: process.env.NETWORK_ID,
        lastSeqnum: 555,
        prevHash: 999
    });
    res.send(RegisterAccountResponse.encodeDelimited(resp_msg).finish());
})



app.listen(process.env.PORT, process.env.BINDADDR, () => {
    console.log(`Server is running at http://${process.env.BINDADDR}:${process.env.PORT}`);
});
