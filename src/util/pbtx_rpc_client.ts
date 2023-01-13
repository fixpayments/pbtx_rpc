import { Command } from 'commander';
const program = new Command();

import { TransactionBody, Transaction, Permission, KeyType }
from '../../lib/generated/pbtx_pb.js';

import {
    RequestResponse, RequestResponse_StatusCode, AccountSeqData,
    RegisterAccount, GetSeq }
from '../../lib/generated/pbtx-rpc_pb.js';

import hash from 'hash.js';
import eosio from '@greymass/eosio';
import fetch from 'node-fetch';
import Long from "long";

const options = program.opts();

program
    .requiredOption('--url [value]', 'PBTX-RPC URL');

program
    .command('regacc')
    .requiredOption('--actor [value]', 'actor ID')
    .requiredOption('--actorkey [value]', 'Actor private key')
    .option('--creds [value]', 'Credentials')
    .description('Register an account or retrieve seqnum and prev_hash')
    .action(async (cmdopts) => {

        const privkey = eosio.PrivateKey.fromString(cmdopts.actorkey);
        const permission_msg = new Permission({
            actor: cmdopts.actor,
            threshold: 1,
            keys: [{
                key: {
                    type: KeyType['EOSIO_KEY'],
                    keyBytes: eosio.Serializer.encode({object: privkey.toPublic()}).array
                },
                weight: 1
            }]
        });

        let creds;
        if( cmdopts.creds !== undefined ) {
            creds = Buffer.from(cmdopts.creds, 'hex');
        }

        const perm_serialized = permission_msg.toBinary();

        const req_serialized = new RegisterAccount({
            permissionBytes: perm_serialized,
            signature: eosio.Serializer.encode({object: privkey.signMessage(perm_serialized)}).array,
            credentials: creds
        }).toBinary();

        const resp :RequestResponse = await call_rpc(req_serialized, '/register_account');
        const getseq_data :AccountSeqData = AccountSeqData.fromBinary(resp.data);

        console.log(JSON.stringify({
            status: resp['status'],
            network_id: getseq_data['networkId'].toString(),
            last_seqnum: getseq_data['lastSeqnum'],
            prev_hash: getseq_data['prevHash'].toString()
        }));
    });


program
    .command('trx')
    .requiredOption('--actor [value]', 'actor ID')
    .requiredOption('--actorkey [value]', 'Actor private key')
    .requiredOption('--type [value]', 'Transaction type')
    .requiredOption('--content [value]', 'Transaction content')
    .description('Send a PBTX transaction')
    .action(async (cmdopts) => {

        let transaction_type = Number(cmdopts.type);
        let transaction_content = Buffer.from(cmdopts.content, 'hex');

        const privkey = eosio.PrivateKey.fromString(cmdopts.actorkey);

        const actor = Number(cmdopts.actor);

        const getseq_serialized  = new GetSeq({actor: actor}).toBinary();
        const getseq_resp :RequestResponse = await call_rpc(getseq_serialized, '/get_seq');
        const getseq_data :AccountSeqData = AccountSeqData.fromBinary(getseq_resp.data);

        console.log('get_seq response data: ' + JSON.stringify(getseq_data));
        let network_id = BigInt(getseq_data['networkId']);
        let last_seqnum = getseq_data['lastSeqnum'] as number;
        let prev_hash = BigInt(getseq_data['prevHash']);

        const trxbody = new TransactionBody({
            networkId: network_id,
            actor: actor,
            seqnum: last_seqnum + 1,
            prevHash: prev_hash,
            transactionType: transaction_type,
            transactionContent: transaction_content});

        const body_serialized = trxbody.toBinary();
        console.log(Buffer.from(body_serialized).toString('hex'));

        const trx_msg_serialized = new Transaction({
            body: body_serialized,
            authorities: [
                {
                    type: 0,
                    sigs: [ eosio.Serializer.encode({object: privkey.signMessage(body_serialized)}).array ]
                }
            ]
        }).toBinary();

        const trx_resp :RequestResponse = await call_rpc(trx_msg_serialized, '/send_transaction');

        console.log(JSON.stringify({
            status: trx_resp['status']
        }));
    });



program.parse(process.argv);


async function call_rpc(req_serialized: Buffer, url: string): RequestResponse
{
    const req_hash = hash.sha256().update(req_serialized).digest();

    const response = await fetch(options.url + url, {
        method: 'POST',
        headers: {'Content-Type': 'application/octet-stream'},
        body: req_serialized});

    if (!response.ok) {
        throw new Error(`HTTP Error Response: ${response.status} ${response.statusText} ${await response.text()}`);
    }

    const resp_decoded = RequestResponse.fromBinary(new Uint8Array(await response.arrayBuffer()));

    if( ! Buffer.from(req_hash).equals(resp_decoded['requestHash']) ) {
        throw new Error(`request_hash in response does not match the request. ` +
                        `Expected: ${req_hash}, Got: ${resp_decoded['requestHash']}`);
    }

    return resp_decoded;
}



/*
 Local Variables:
 mode: javascript
 indent-tabs-mode: nil
 End:
*/
