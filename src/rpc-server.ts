import express from 'express';

import dotenv from 'dotenv-defaults';
dotenv.config();

import { TransactionBody, Transaction, Permission }
from '../lib/generated/pbtx_pb.js';

import {
    RequestResponse, RequestResponse_StatusCode, AccountSeqData,
    RegisterAccount, GetSeq }
from '../lib/generated/pbtx-rpc_pb.js';

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



// Blockchain interaction
const adminPrivateKey = eosio.PrivateKey.fromString(process.env['ANTELOPE_ADMIN_PK'] as string);
const workerPrivateKey = eosio.PrivateKey.fromString(process.env['ANTELOPE_WORKER_PK'] as string);
const chainAPI = new eosio.APIClient({provider: new eosio.FetchProvider(process.env['ANTELOPE_RPC_URL'] as string)});

{
    const info = await chainAPI.v1.chain.get_info();
    if( info.chain_id.hexString != process.env['ANTELOPE_CHAINID'] ) {
        console.error(`Chain ID retrieved from ${process.env['ANTELOPE_RPC_URL']} differs ` +
                      `from expected ${process.env['ANTELOPE_CHAINID']}`);
        process.exit(1);
    }
    else {
        console.info(`Antelope RPC URL: ${process.env['ANTELOPE_RPC_URL']}`);
        console.info(`Chain ID: ${info.chain_id.hexString}`);
    }
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
const network_id: BigInt = BigInt(process.env['NETWORK_ID'] as string);

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
    req.sha256digest = Buffer.from(hash.sha256().update(req.body).digest());
    next();
});


app.post(process.env.URL_PATH + '/register_account', async (req, res) => {
    let logprefix = req.ip + ' ';
    console.log(logprefix + 'request: register_account');
    const msg = RegisterAccount.fromBinary(req.body);
    console.log(logprefix + 'body: ' + JSON.stringify(msg));

    let last_seqnum :number = 0;
    let prev_hash :BigInt = BigInt(0);
    let status = RequestResponse_StatusCode.SUCCESS;

    const perm = Permission.fromBinary(msg['permissionBytes']);
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

    const actor = perm['actor'];

    if( !verified ) {
        status = RequestResponse_StatusCode.values.INVALID_SIGNATURE;
        console.error(logprefix + `Cannot verify the signature for actor: ${actor}`);
    }
    else {
        console.log(logprefix + `Signature verified for actor: ${actor}`);

        const acc_res = await chainAPI.v1.chain.get_table_rows({
            code: pbtx_contract,
            table: 'actorperm',
            scope: eosio.UInt64.from(network_id),
            key_type: 'i64',
            limit: 1,
            lower_bound: actor
        });

        if( acc_res.rows.length == 1 && acc_res.rows[0].actor == actor ) {
            if( ! Buffer.from(msg['permissionBytes']).equals(Buffer.from(acc_res.rows[0].permission, 'hex')) ) {
                status = RequestResponse_StatusCode.DUPLICATE_ACTOR;
                console.error(logprefix + `Actor ${actor} already exists with a different permission`);
            }
            else {
                const seq_res = await chainAPI.v1.chain.get_table_rows({
                    code: pbtx_contract,
                    table: 'actorseq',
                    scope: eosio.UInt64.from(network_id),
                    key_type: 'i64',
                    limit: 1,
                    lower_bound: actor
                });

                if( seq_res.rows.length != 1 || seq_res.rows[0].actor != actor ) {
                    throw new Error(logprefix + `Corrupted data in actorseq table`);
                }

                last_seqnum = seq_res.rows[0].seqnum;
                prev_hash = BigInt(seq_res.rows[0].prev_hash);
            }
        }
        else {
            console.log(logprefix + `Actor ${actor} is new, registering it on blokchain`);

            const info = await chainAPI.v1.chain.get_info();
            const transaction = eosio.Transaction.from(
                {
                    ...info.getTransactionHeader(120),
                    actions: [
                        eosio.Action.from(
                            {
                                account: pbtx_contract,
                                name: 'regactor',
                                authorization: [{ actor: pbtx_admin, permission: 'active' }],
                                data: {
                                    network_id: network_id,
                                    permission: msg['permissionBytes'],
                                },
                            },
                            pbtx_abi.abi)
                    ]
                });

            const signature = adminPrivateKey.signDigest(transaction.signingDigest(info.chain_id));
            const signedTransaction = eosio.SignedTransaction.from({...transaction, signatures: [signature]});
            const trx_result = await chainAPI.v1.chain.send_transaction2(signedTransaction);
            if( trx_result.processed['except'] ) {
                status = RequestResponse_StatusCode.INFRASTRUCTURE_ERROR;
                console.error(logprefix + 'Antelope transaction failed');
                console.error(logprefix + JSON.stringify(trx_result));
            }
            else {
                console.log(logprefix + `Sent transaction ${trx_result.transaction_id}`);
            }
        }
    }

    const seq_data = new AccountSeqData({
        networkId: network_id,
        lastSeqnum: last_seqnum,
        prevHash: prev_hash});

    const resp_msg = new RequestResponse({
        requestHash: req.sha256digest,
        status: status,
        data: seq_data.toBinary()});

    res.send(Buffer.from(resp_msg.toBinary()));
    console.log(logprefix + `Sent response with status: ${status}`);
});


app.post(process.env.URL_PATH + '/get_seq', async (req, res) => {
    let logprefix = req.ip + ' ';
    console.log(logprefix + 'request: get_seq');
    const msg = GetSeq.fromBinary(req.body);
    console.log(logprefix + 'body: ' + JSON.stringify(msg));
    const actor = msg['actor'];

    let last_seqnum :number = 0;
    let prev_hash :BigInt = BigInt(0);
    let status = RequestResponse_StatusCode.SUCCESS;

    const seq_res = await chainAPI.v1.chain.get_table_rows({
        code: pbtx_contract,
        table: 'actorseq',
        scope: eosio.UInt64.from(network_id),
        key_type: 'i64',
        limit: 1,
        lower_bound: actor
    });

    if( seq_res.rows.length != 1 || seq_res.rows[0].actor != actor ) {
        status = RequestResponse_StatusCode.values.INVALID_ACTOR;
        console.error(logprefix + `Unknown actor: ${actor}`);
    }
    else {
        last_seqnum = seq_res.rows[0].seqnum;
        prev_hash = BigInt(seq_res.rows[0].prev_hash);
    }

    const seq_data = new AccountSeqData({
        networkId: network_id,
        lastSeqnum: last_seqnum,
        prevHash: prev_hash});

    const resp_msg = new RequestResponse({
        requestHash: req.sha256digest,
        status: status,
        data: seq_data.toBinary()});

    res.send(Buffer.from(resp_msg.toBinary()));
    console.log(logprefix + 'Sent response: ' + JSON.stringify(resp_msg));
});


app.post(process.env.URL_PATH + '/send_transaction', async (req, res) => {
    let logprefix = req.ip + ' ';
    console.log(logprefix + 'request: send_transaction');
    const trx = Transaction.fromBinary(req.body);
    console.log(logprefix + 'trx: ' + JSON.stringify(trx));
    const trxbody = TransactionBody.fromBinary(trx['body']);
    console.log(logprefix + 'trxbody: ' + JSON.stringify(trxbody));
    const actor = trxbody['actor'];

    let status = RequestResponse_StatusCode.SUCCESS;

    if( trxbody['networkId'].toString() != network_id ) {
        status = RequestResponse_StatusCode.INVALID_NETWORK_ID;
        console.error(logprefix + `Wrong network ID: ${trxbody['networkId'].toString()}, expected: ${network_id}`);
    }
    else {
        const seq_res = await chainAPI.v1.chain.get_table_rows({
            code: pbtx_contract,
            table: 'actorseq',
            scope: eosio.UInt64.from(network_id),
            key_type: 'i64',
            limit: 1,
            lower_bound: actor
        });

        if( seq_res.rows.length != 1 || seq_res.rows[0].actor != actor ) {
            status = RequestResponse_StatusCode.values.INVALID_ACTOR;
            console.error(logprefix + `Unknown actor: ${actor}`);
        }
        else if( trxbody['seqnum'] != seq_res.rows[0].seqnum + 1 || trxbody['prevHash'] != String(seq_res.rows[0].prev_hash) ) {
            status = RequestResponse_StatusCode.values.INVALID_SEQ;
            console.error(logprefix + `INVALID_SEQ: seqnum=${trxbody['seqnum']} prev_hash=${trxbody['prevHash']}, ` +
                          `expected: ${seq_res.rows[0].seqnum + 1}, ${seq_res.rows[0].prev_hash}`);
        }
        else {
            const info = await chainAPI.v1.chain.get_info();
            const transaction = eosio.Transaction.from(
                {
                    ...info.getTransactionHeader(120),
                    actions: [
                        eosio.Action.from(
                            {
                                account: pbtx_contract,
                                name: 'exectrx',
                                authorization: [{ actor: pbtx_worker, permission: 'active' }],
                                data: {
                                    worker: pbtx_worker,
                                    trx_input: req.body
                                },
                            },
                            pbtx_abi.abi)
                    ]
                });

            const signature = workerPrivateKey.signDigest(transaction.signingDigest(info.chain_id));
            const signedTransaction = eosio.SignedTransaction.from({...transaction, signatures: [signature]});
            const trx_result = await chainAPI.v1.chain.send_transaction2(signedTransaction);
            if( trx_result.processed['except'] ) {
                status = RequestResponse_StatusCode.values.INVALID_CONTENT;
                console.error(logprefix + 'Antelope transaction failed');
                console.error(logprefix + JSON.stringify(trx_result));
            }
            else {
                console.log(logprefix + `Sent transaction ${trx_result.transaction_id}`);
            }
        }
    }

    const resp_msg = new RequestResponse({
        requestHash: req.sha256digest,
        status: status});

    res.send(Buffer.from(resp_msg.toBinary()));
    console.log(logprefix + `Sent response with status: ${status}`);
});


app.listen(process.env.PORT, process.env.BINDADDR, () => {
    console.log(`Server is running at http://${process.env.BINDADDR}:${process.env.PORT}`);
});


/*
 Local Variables:
 mode: javascript
 indent-tabs-mode: nil
 End:
*/
