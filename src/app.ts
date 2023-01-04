import express from 'express';

import dotenv from 'dotenv-defaults';
dotenv.config();

import protobuf from 'protobufjs';
import hash from 'hash.js';
import eosio from '@greymass/eosio';



const required_options = ['PORT', 'BINDADDR', 'URL_PATH', 'NETWORK_ID', 'ANTELOPE_CHAINID', 'ANTELOPE_RPC_URL', 'ANTELOPE_CONTRACT',
                          'ANTELOPE_ADMIN', 'ANTELOPE_ADMIN_PK', 'ANTELOPE_WORKER', 'ANTELOPE_WORKER_PK'];


for (const opt of required_options) {
    if( process.env[opt] === undefined ) {
        console.error(`Environment option ${opt} is not defined`);
        process.exit(1);
    }
}

const rpc_root = protobuf.loadSync('pbtx-rpc.proto').root;
const pbtx_root = protobuf.loadSync('pbtx/pbtx.proto').root;

const RegisterAccount = rpc_root.lookupType('pbtxrpc.RegisterAccount');
const RegisterAccountResponse = rpc_root.lookupType('pbtxrpc.RegisterAccountResponse');
const Permission = pbtx_root.lookupType('pbtx.Permission');


// Blockchain interaction
const adminPrivateKey = eosio.PrivateKey.fromString(process.env['ANTELOPE_ADMIN_PK'] as string);
const workerPrivateKey = eosio.PrivateKey.fromString(process.env['ANTELOPE_WORKER_PK'] as string);
const chainAPI = new eosio.APIClient({provider: new eosio.FetchProvider(process.env['ANTELOPE_RPC_URL'] as string)});

const info = await chainAPI.v1.chain.get_info();
if( info.chain_id.hexString != process.env['ANTELOPE_CHAINID'] ) {
    console.error(`Chain ID retrieved from ${process.env['ANTELOPE_RPC_URL']} differs from expected ${process.env['ANTELOPE_CHAINID']}`);
    process.exit(1);
}
else {
    console.info(`Antelope RPC URL: ${process.env['ANTELOPE_RPC_URL']}`);
    console.info(`Chain ID: ${info.chain_id.hexString}`);
}

for (const acctype of ['ANTELOPE_CONTRACT', 'ANTELOPE_ADMIN', 'ANTELOPE_WORKER']) {
    try {
        await chainAPI.v1.chain.get_account(process.env[acctype] as string);
    }
    catch(err) {
        console.error(`Invalid account specified in ${acctype}: ${process.env[acctype]}`);
        process.exit(1);
    }
}

const pbtx_contract: string = process.env['ANTELOPE_CONTRACT'] as string;
const pbtx_admin: string = process.env['ANTELOPE_ADMIN'] as string;
const pbtx_worker: string = process.env['ANTELOPE_WORKER'] as string;
const network_id: string = process.env['NETWORK_ID'] as string;

const pbtx_abi = await chainAPI.v1.chain.get_abi(pbtx_contract);

console.info(`PBTX contract: ${pbtx_contract}`);
console.info(`PBTX Network ID: ${network_id}`);

{
    const res = await chainAPI.v1.chain.get_table_rows({
        code: pbtx_contract,
        table: 'networks',
        scope: '0',
        key_type: 'i64',
        limit: 1,
        lower_bound: eosio.UInt64.from(network_id),
    });

    if( res.rows[0].network_id != network_id ) {
        console.error(`No such Network ID: ${network_id}`);
        process.exit(1);
    }
    
    if( res.rows[0].admin_acc != pbtx_admin ) {
        console.error(`Network ID ${network_id} defines admin ${res.rows[0].admin_acc}, but ${pbtx_admin} is configured`);
        process.exit(1);
    }        
}


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


app.post(process.env.URL_PATH + '/register_account', async (req, res) => {
    let logprefix = req.ip + ' ';
    console.log(logprefix + 'request: register_account');
    const msg = RegisterAccount.decodeDelimited(req.body);
    console.log(logprefix + 'body: ' + JSON.stringify(msg));

    const perm = Permission.decode(msg['permissionBytes']);
    console.log(logprefix + 'perm: ' +  JSON.stringify(perm));

    const sig = eosio.Serializer.decode({data: msg['signature'], type: eosio.Signature});

    let verified = false;
    for (let keyweight of perm['keys']) {
        if( keyweight['key']['type'] != 0 ) {
            throw new Error(logprefix + `Unexpected key type: ${keyweight['key']['type']}`);
        }
        let pubKey = eosio.Serializer.decode({data: keyweight['key']['keyBytes'], type: eosio.PublicKey});

        if( sig.verifyMessage(msg['permissionBytes'], pubKey) ) {
            verified = true;
            break;
        }
    }

    if( !verified ) {
        throw new Error(logprefix + 'Cannot verify the signature in pbtxrpc.RegisterAccount message');
    }
    
    const actor = eosio.UInt64.from(perm['actor']);
    console.log(logprefix + `Signature verified for actor: ${actor}`);
    
    const acc_res = await chainAPI.v1.chain.get_table_rows({
        code: pbtx_contract,
        table: 'actorperm',
        scope: network_id,
        key_type: 'i64',
        limit: 1,
        lower_bound: actor
    });


    
    const resp_msg = RegisterAccountResponse.create({
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
