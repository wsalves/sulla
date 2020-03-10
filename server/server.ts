const express = require('express');
const { check, validationResult } = require('express-validator');

//const sulla = require('sulla-hotfix');
import { create, Whatsapp, decryptMedia, ev } from '../src/index';
const mime = require('mime-types');
const fs = require('fs');

const uaOverride =
  'WhatsApp/2.16.352 Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Safari/605.1.15';
const tosBlockGuaranteed =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/79.0.3945.88 Safari/537.36';
const ON_DEATH = require('death');
let globalClient: Whatsapp;

const app = express();
app.use(express.json());

app.use(function(req, res, next) {
  if (!req.headers || !req.headers['auth-key']) {
    return res
      .status(403)
      .json({ cd_error: 403, error: 'Credenciais não enviadas!' });
  } else {
    const key = req.headers['auth-key'];
    if ('fe99caad-69c1-4831-b744-cf9b117dfc72' !== key) {
      return res
        .status(403)
        .json({ cd_error: 403, error: 'Credencial inválida!' });
    }
  }
  next();
});

ON_DEATH(async function(signal, err) {
  console.log('killing session');
  if (globalClient) await globalClient.kill();
});

ev.on('qr.**', async (qrcode, sessionId) => {
  // console.log("TCL: qrcode", qrcode)
  //     console.log("TCL: qrcode,sessioId", qrcode,sessionId)
  //base64 encoded qr code image
  const imageBuffer = Buffer.from(
    qrcode.replace('data:image/png;base64,', ''),
    'base64'
  );
  fs.writeFileSync(
    `qr_code${sessionId ? '_' + sessionId : ''}.png`,
    imageBuffer
  );
});

ev.on('**', async (data, sessionId, namespace) => {
  console.log('\n----------');
  console.log('EV', data, sessionId, namespace);
  console.log('----------');
});

ev.on('sessionData.**', async (sessionData, sessionId) => {
  console.log('\n----------');
  console.log('sessionData', sessionId, sessionData);
  console.log('----------');
});

const sullaParams = {
  useChrome: true,
  headless: false,
  throwErrorOnTosBlock: true,
  killTimer: 40,
  autoRefresh: true, //default to true
  qrRefreshS: 15
};

const sessionName = 'prospex';

create(sessionName, sullaParams)
  // create()
  .then(async client => await start(client))
  .catch(e => {
    console.log('Error', e.message);
    // process.exit();
  });

function start(client) {
  globalClient = client;
  client.onStateChanged(state => {
    console.log('statechanged', state);
    if (state === 'CONFLICT') client.forceRefocus();
  });
  client.onAnyMessage(message => console.log(message.type));
  client.onMessage(async message => {
    try {
      const isConnected = await client.isConnected();
      console.log('TCL: start -> isConnected', isConnected);
      if (message.mimetype) {
        const filename = `${message.t}.${mime.extension(message.mimetype)}`;
        const mediaData = await decryptMedia(message, uaOverride);
        // client.sendImage(message.from,`data:${message.mimetype};base64,${mediaData.toString('base64')}`,filename,`You just sent me this ${message.type}`);
        // client.forwardMessages(message.from,message,false);
        fs.writeFile(filename, mediaData, function(err) {
          if (err) {
            return console.log(err);
          }
          console.log('The file was saved!');
        });
      } else if (message.type === 'location') {
        console.log(
          'TCL: location -> message',
          message.lat,
          message.lng,
          message.loc
        );
        await client.sendLocation(
          message.from,
          `${message.lat}`,
          `${message.lng}`,
          `You are at ${message.loc}`
        );
      } else {
        // client.sendText(message.from, message.body);
        // client.sendGiphy(message.from,'https://media.giphy.com/media/oYtVHSxngR3lC/giphy.gif','Oh my god it works');
      }
    } catch (error) {
      console.log('TCL: start -> error', error);
    }
  });
}

app.get('/getAllUnreadMessages', async (req, res) => {
  const newMessages = await globalClient.getAllUnreadMessages();
  return res.send(newMessages);
});

app.get('/isConnected', async (req, res) => {
  if (globalClient) {
    const states = await globalClient.getConnectionState();
    return res.send(states);
  }
  return res.send('DISCONNECTED');
});

app.post(
  '/sendText',
  [check('id_unique').exists(), check('body').exists(), check('to').exists()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }

    if (!globalClient || globalClient == null) {
      return res.send({ cd_error: 1, error: 'Instância não está ativa!' });
    }

    const states = await globalClient.getConnectionState();
    if (states !== 'CONNECTED') {
      return res.send({
        cd_error: 2,
        error: 'Instância está em modo ' + states
      });
    }

    console.log('body is ', req.body);
    const message = req.body;
    const newMessage = await globalClient.sendText(message.to, message.body);
    return res.send(newMessage);
  }
);

app.listen(5000, function() {
  console.log('Example app listening on port 5000!');
});
