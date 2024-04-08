const https = require('https');
const dotenv = require('dotenv');
const crypto = require('crypto');
const {finalizeEvent, Relay, useWebSocketImplementation} = require('nostr-tools');
const WebSocket = require('ws');

useWebSocketImplementation(WebSocket);

dotenv.config();

// Helper function to generate preimage and hash
function generatePreimageAndHash() {
  const preimage = crypto.randomBytes(32);
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return { preimage: preimage.toString('hex'), hash: hash.toString('hex') };
}

// Function to create an invoice with a pre-generated r_preimage and r_hash
function createInvoice() {
  const { preimage, hash } = generatePreimageAndHash();

  // Convert to base64 as required by LND
  const r_preimage_base64 = Buffer.from(preimage, 'hex').toString('base64');
  const r_hash_base64 = Buffer.from(hash, 'hex').toString('base64');

  console.log('Preimage: ', r_preimage_base64);
  console.log('Hash: ', r_hash_base64);

  const postData = JSON.stringify({
    value: 210000000000,
    r_preimage: r_preimage_base64, // Include preimage in base64
    r_hash: r_hash_base64, // Include hash in base64
  });

  const options = {
    hostname: process.env.HOST,
    port: 443, // Default HTTPS port
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

    // Write data to request body
    req.write(postData);
    req.end();
  });
}

async function createZapRequest(senderPublicKey, recipientPublicKey, eventId, amount, relays, content = "") {
  const zapRequest = {
    kind: 9734,
    content,
    tags: [
      ["p", recipientPublicKey],
      ["e", eventId],
      ["relays", ...relays],
      ["amount", amount.toString()],
    ],
    created_at: Math.floor(Date.now() / 1000),
  };

  const signedZapRequest = await finalizeEvent(zapRequest, process.env.PRIVKEY);
  return signedZapRequest;
}

async function createZapReceipt(invoice, zapRequest) {
  const zapReceipt = {
    kind: 9735,
    content: "",
    tags: [
      ["p", zapRequest.tags.find(t => t[0] === "p")[1]],
      ["e", zapRequest.tags.find(t => t[0] === "e")[1]],
      ...(zapRequest.tags.find(t => t[0] === "a") ? [["a", zapRequest.tags.find(t => t[0] === "a")[1]]] : []),
      ["bolt11", invoice.payment_request],
      ["description", JSON.stringify(zapRequest)],
      ["preimage", invoice.r_preimage],
    ],
    created_at: Math.floor(Date.now() / 1000),
  };

  const signedZapReceipt = await finalizeEvent(zapReceipt, process.env.PRIVKEY);
  return signedZapReceipt;
}

async function processZap(senderPublicKey, recipientPublicKey, eventId, amount, relays, content) {
  const zapRequest = await createZapRequest(senderPublicKey, recipientPublicKey, eventId, amount, relays, content);

  // Create the invoice using the existing createInvoice function
  const invoice = await createInvoice();

  // Create the zap receipt using the existing createZapReceipt function
  const zapReceipt = await createZapReceipt(invoice, zapRequest);

  // Create a Relay instance and connect to the relay
  const relay = await Relay.connect(relays[0]);

  // Publish the zap receipt to the relay
  await relay.publish(zapReceipt);

  // Close the relay connection
  await relay.close();

  // Handle the zap receipt as needed
  console.log("Zap receipt created:", zapReceipt);
}

processZap(process.env.PUBKEY, "8172b9205247ddfe99b783320782d0312fa305a199fb2be8a3e6563e20b4f0e2", "eda5770aad7b57668a3e8ff69c5b054169becd1abcfb6dad44ee152ca185bd18", 210000000000, ["wss://nostr.mutinywallet.com", "wss://relay.mutinywallet.com"], "⚡");