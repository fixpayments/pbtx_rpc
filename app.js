"use strict";

const express = require('express');
require('dotenv-defaults').config();

const required_options = ['PORT', 'BINDADDR', 'URL_PATH', 'NETWORK_ID', 'ANTELOPE_RPC', 'ANTELOPE_CONTRACT',
                          'ANTELOPE_ADMIN', 'ANTELOPE_ADMIN_PK', 'ANTELOPE_WORKER', 'ANTELOPE_WORKER_PK'];


for (const opt of required_options) {
    if( process.env[opt] === undefined ) {
        console.error(`Environment option ${opt} is not defined`);
        process.exit(1);
    }
}


const app = express();

app.listen(process.env.PORT, process.env.BINDADDR, () => {
  console.log(`Server is running at http://${process.env.BINDADDR}:${process.env.PORT}`);
});
