const express = require('express');
const { check, validationResult } = require('express-validator');

//const sulla = require('sulla-hotfix');
import { create, Whatsapp, decryptMedia, ev } from '../src/index';
import { SessionWhatsapp } from './sessions';
import { Database } from './database';
const mime = require('mime-types');
const fs = require('fs');
const mysql = require('mysql');

const uaOverride =
  'WhatsApp/2.16.352 Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Safari/605.1.15';
const tosBlockGuaranteed =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/79.0.3945.88 Safari/537.36';
const ON_DEATH = require('death');

const auth_key = 'fe99caad-69c1-4831-b744-cf9b117dfc72';
const session1 = '553492630155';
const session2 = '553492804074';
const session3 = '553492761721';

const ClientSessions: Map<string, SessionWhatsapp[]> = new Map([
  [
    auth_key,
    [
      new SessionWhatsapp(session1, null),
      new SessionWhatsapp(session2, null),
      new SessionWhatsapp(session3, null)
    ]
  ]
]);

const app = express();
app.use(express.json());

app.use(function(req, res, next) {
  if (!req.headers || !req.headers['auth-key']) {
    return res
      .status(403)
      .json({ cd_error: 403, error: 'Credenciais não enviadas!' });
  } else {
    const key = req.headers['auth-key'];
    if (auth_key !== key) {
      return res
        .status(403)
        .json({ cd_error: 403, error: 'Credencial inválida!' });
    }
  }
  next();
});

ON_DEATH(async function(signal, err) {
  console.log('killing session');
  //if (globalClient) await globalClient.kill();
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

function createNextSession() {
  var nextSession = getNextDisconnectedSession();
  if (nextSession){
    create(nextSession.session, sullaParams)
      .then(async client => {
        await start(client);
      })
      .catch(e => {
        console.log('Error', e.message);
      });
  }
}



function getNextDisconnectedSession(): SessionWhatsapp {
  var sessions = getSessions(auth_key);
  if (sessions) {
      return sessions.find(w => w.client == null);
  }
  return null;
}


function getSessions(key: string): SessionWhatsapp[] {
  if (ClientSessions.has(key)) {
    return ClientSessions.get(key);
  }
  return null;
}

function getSessionsBySessionId(
  key: string,
  sessionId: string
): SessionWhatsapp {
  if (ClientSessions.has(key)) {
    return ClientSessions.get(key).find(w => w.session === sessionId);
  }
  return null;
}

function getRequestKey(req): string {
  if (!req.headers || !req.headers['auth-key']) {
    return null;
  } else {
    return req.headers['auth-key'];
  }
}

function updateClientWhatsapp(key: string, client: Whatsapp) {
  if (ClientSessions.has(key)) {
    var sessions = ClientSessions.get(key);
    if (sessions) {
      var result = sessions.find(w => w.session === client.sessionId);
      if (result) {
        result.client = client;
      }
    }
  }
}

async function start(client) {
  
  updateClientWhatsapp(auth_key, client);
  
  createNextSession();

  const unreadMessages = await client.getAllUnreadMessages();
  if (unreadMessages && unreadMessages.length > 0) {
    var chatsIds = unreadMessages.reduce(function (r, a) {
      if (!r.includes(a.from)) {
        r.push(a.from);
      }
      return r;
    }, []);

    if (chatsIds && chatsIds.length > 0){
      chatsIds.forEach((message) => {
        sendResponseChatId(client, message);  
      });

    }

  }
  
  client.onStateChanged(state => {
    console.log('statechanged', state);
    if (state === 'CONFLICT') client.forceRefocus();
  });

  //client.onAnyMessage(message => console.log(message.type));

  client.onMessage(async message => {
    try {
      const isConnected = await client.isConnected();
      if (isConnected){
          console.log(
            'TCL: start -> SessionId: %s isConnected: %s',
            client.sessionId,
            isConnected
          );
          sendResponseChatId(client, message.from);  
        }
    } catch (error) {
      console.log('TCL: start -> error', error);
    }
  });
}

function cuidToJid(cuid) {
  return cuid.indexOf('@') < 0 ? cuid + '@c.us' : cuid;
}


function getLastUniqueIdChat(client: Whatsapp, chatId: string) {
  return new Promise((resolve, reject ) => {
    client.getAllMessagesInChat(chatId, true, false).then(async (mensagens) => {
      const connection = createConnection();
      if (mensagens && mensagens.length > 0) {
        const msgReverse = mensagens.reverse();
        for (let index = 0; index < msgReverse.length; index++) {
          const mensagem = msgReverse[index];
          if (mensagem.sender.isMe) {
            const result = await connection.query(`SELECT id_cliente FROM tbl_mensagem where id_integracao = '${mensagem.id}' limit 1`);
            //@ts-ignore
            if (result && result.length > 0){
              return resolve(result[0].id_cliente);
            }
          }
        }
      }  
      return resolve(null);    
    });
  });
}

function sendResponseChatId(client: Whatsapp, chatId: string) {
  getLastUniqueIdChat(client, chatId).then((value) => {
    if (value) {
      client.sendText(
        chatId,
        'Esta mensagem foi enviada pelo nosso atendente virtual, por favor entre em contato pelos telefones descritos na mensagem. Utilizaremos mais este canal de comunicação para nos mantermos sempre próximos e deixá-lo(a) informado das suas consultas e benefícios!'
      );
    } else {
      client.sendText(
        chatId,
        'Esta mensagem foi enviada pelo nosso atendente virtual, por favor entre em contato pelos telefones descritos na mensagem. Utilizaremos mais este canal de comunicação para nos mantermos sempre próximos e deixá-lo(a) informado das suas consultas e benefícios!'
      );
    }
  });  
}


app.get('/getAllUnreadMessages', async (req, res) => {
  const key = getRequestKey(req);
  const sessions = getSessions(key);
  if (sessions) {
    var result = [];
    for (let index = 0; index < sessions.length; index++) {
      const session = sessions[index]; 
      if (session.client) {
          const newMessages = await session.client.getAllUnreadMessages();
          result.push({ session: session.session, data: newMessages });
      }else{
        result.push({ session: session.session, data: null });
      }
    };
    return res.send(result);
  }
  return res.send({ session: 'UNKNOWN', data: null });
});



app.get('/isConnected', async (req, res) => {
  const key = getRequestKey(req);
  const sessions = getSessions(key);
  if (sessions) {
    var states = [];
    for (let index = 0; index < sessions.length; index++) {
      const session = sessions[index]; 
      if (session.client) {
          const status = await session.client.getConnectionState();
          states.push({ session: session.session, status: status });
      }else{
        states.push({ session: session.session, status: 'DISCONNECTED' });
      }
    };
    return res.send(states);
  }
  return res.send({ session: 'UNKNOWN', status: 'DISCONNECTED' });
});

app.get('/isSessionConnected/:sessionid', async (req, res) => {
  const key = getRequestKey(req);
  const sessionid = req.params.sessionid;
  const session = getSessionsBySessionId(key, sessionid);
  if (session) {
    var states = [];
    if (session.client) {
      const status = await session.client.getConnectionState();
      states.push({ session: session.session, status: status });
    }else{
      states.push({ session: session.session, status: 'DISCONNECTED' });
    }
    return res.send(states);
  }
  return res.send({ session: 'UNKNOWN', status: 'DISCONNECTED' });
});

app.get('/getSessionAllUnreadMessages/:sessionid', async (req, res) => {

  const key = getRequestKey(req);
  const sessionid = req.params.sessionid;
  const session = getSessionsBySessionId(key, sessionid);
  if (session) {
    var result = [];
    if (session.client) {
      const newMessages = await session.client.getAllUnreadMessages();
      result.push({ session: session.session, data: newMessages });
    } else {
      result.push({ session: session.session, data: null });
    }
    return res.send(result);
  }
  return res.send({ session: 'UNKNOWN', data: null });
});


app.post(
  '/sendText',
  [check('id_unique').exists(), check('body').exists(), check('from').exists(), check('to').exists()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }

    console.log('body is ', req.body);
    const message = req.body;

    const key = getRequestKey(req);
    const sessionid = message.from;
    const session = getSessionsBySessionId(key, sessionid);
    if (!session || !session.client) {
      return res.send({ cd_error: 1, ds_error: 'Instância não está ativa ou não localizada!' });
    }

    const states = await session.client.getConnectionState();
    if (states !== 'CONNECTED') {
      return res.send({
        cd_error: 2,
        ds_error: 'Instância está em modo ' + states
      });
    }
    const jid = cuidToJid(message.to);

    /*
    let contact;
    contact = await globalClient.checkNumberStatus(jid);
    if (!contact || contact === 404 || contact.status !== 200) {
      return res.send({
        cd_error: 3,
        ds_error: 'Whatsapp ' + message.to + ' não localizado.'
      });
    }
    */

    const newMessage = await session.client.sendText(jid, message.body);

    if (newMessage) {
      try {
        await insertMessage(message.body, message.from, message.to, message.id_unique, newMessage);
        return res.send({ cd_error: 0, id: newMessage});  
      } catch (error) {
        return res.send({
          cd_error: 999,
          ds_error: error,
        });
      }
    } else {
      return res.send({
        cd_error: 3,
        ds_error: 'Whatsapp ' + message.to + ' não localizado.'
      });
    }
  }
);

app.listen(5000, function() {
  console.log('App listening on port 5000!');
  createNextSession();
});

function insertMessage(ds_mensagem: string, ds_from: string, ds_to: string, id_cliente: string, id_integracao: string) {
  const connection = createConnection();
  return connection.query(`insert into tbl_mensagem(ds_mensagem, ds_from, ds_to, id_cliente, id_integracao) values ('${ds_mensagem}','${ds_from}','${ds_to}','${id_cliente}','${id_integracao}')`);
}

function createConnection(){
  return new Database({
    connectionLimit: 10,
    host: 'dbmysqltreinamento.cue5nkbghdzf.sa-east-1.rds.amazonaws.com',
    port: 3306,
    user: 'user_marketing',
    password: '*RD04dm06#',
    database: 'db_marketing',
  });
}


