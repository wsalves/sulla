const express = require('express');
const { check, validationResult } = require('express-validator');
var request = require('request');

//const sulla = require('sulla-hotfix');
import { create, Whatsapp, decryptMedia, ev } from '../src/index';
import { SessionWhatsapp, RequisicaoRespostaWhatsapp, RespostasWhatsapp } from './sessions';
import { Database } from './database';
const fs = require('fs');

const uaOverride = 'WhatsApp/0.4.2088 Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.122 Safari/537.36';
//const uaOverride ='WhatsApp/0.4.2088 Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36';
const tosBlockGuaranteed = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36';
const ON_DEATH = require('death');

const auth_key = 'fe99caad-69c1-4831-b744-cf9b117dfc72';
const session1 = '553499577178';
const session2 = '553492804074';
const session3 = '553492761721';

const ClientSessions: Map<string, SessionWhatsapp[]> = new Map([
  [
    auth_key,
    [
      new SessionWhatsapp(session1, null)//,
      //new SessionWhatsapp(session2, null)//,
      //new SessionWhatsapp(session3, null)
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
  killAllSessions();
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
  headless: true,
  throwErrorOnTosBlock: true,
  killTimer: 40,
  autoRefresh: true, //default to true
  qrRefreshS: 15,
};

function createNextSession() {
  var nextSession = getNextDisconnectedSession();
  if (nextSession){
    create(nextSession.session, sullaParams, uaOverride)
      .then(async (client) => {
        await start(client);
      })
      .catch((e) => {
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
    var requisicao = new RequisicaoRespostaWhatsapp();
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
              requisicao.Cd_Requisicao = result[0].id_cliente;
              requisicao.Respostas = requisicao.Respostas.reverse();
              return resolve(requisicao);
            }
          }else{
            //@ts-ignore
            requisicao.Respostas.push(new RespostasWhatsapp(mensagem.body, new Date(mensagem.t*1000), mensagem.to.user));
          }
        }
      }  
      return resolve(null);    
    });
  });
}

function sendResponseChatId(client: Whatsapp, chatId: string) {
  getLastUniqueIdChat(client, chatId).then((value : RequisicaoRespostaWhatsapp) => {
    if (value && value.Cd_Requisicao) {
      postPollRespostaAutomatica(value).then(async (response) => {
        //@ts-ignore
        if (response && response.Cd_Erro === 0) {
          //@ts-ignore
          if (response.Requisicoes && response.Requisicoes.length > 0) {
            //@ts-ignore
            var result = await sendMessageText(
              auth_key,
              //@ts-ignore
              response.Requisicoes[0].Cd_Requisicao,
              //@ts-ignore
              response.Requisicoes[0].Nr_Envio,
              //@ts-ignore
              formatWhatsNumberAndContryCode(response.Requisicoes[0].Nr_Destino),
              //@ts-ignore
              response.Requisicoes[0].Ds_Mensagem
            );
          }

          //@ts-ignore
          if (response.Requisicoes && response.Requisicoes.length > 1) {
            //@ts-ignore
            var result = await sendMessageText(
              auth_key,
              //@ts-ignore
              response.Requisicoes[1].Cd_Requisicao,
              //@ts-ignore
              response.Requisicoes[1].Nr_Envio,
              //@ts-ignore
              formatWhatsNumberAndContryCode(response.Requisicoes[1].Nr_Destino),
              //@ts-ignore
              response.Requisicoes[1].Ds_Mensagem
            );
          }
        } else {
          //@ts-ignore
          client.sendText(
            chatId,
            'Esta mensagem foi enviada pelo nosso atendente virtual, por favor entre em contato pelos telefones descritos na mensagem. Utilizaremos mais este canal de comunicação para nos mantermos sempre próximos e deixá-lo(a) informado das suas consultas e benefícios!'
          );
        }
      }).catch((error) => {
        client.sendText(
          chatId,
          'Esta mensagem foi enviada pelo nosso atendente virtual, por favor entre em contato pelos telefones descritos na mensagem. Utilizaremos mais este canal de comunicação para nos mantermos sempre próximos e deixá-lo(a) informado das suas consultas e benefícios!'
        );
      });
    } else {
      client.sendText(
        chatId,
        'Esta mensagem foi enviada pelo nosso atendente virtual, por favor entre em contato pelos telefones descritos na mensagem. Utilizaremos mais este canal de comunicação para nos mantermos sempre próximos e deixá-lo(a) informado das suas consultas e benefícios!'
      );
    }
  });  
}

function killAllSessions(){
  var sessions = getSessions(auth_key);
  if (sessions && sessions.length > 0){
    sessions.forEach((session) => {
      if (session && session.client) {
        session.client.kill();
      }
    });
  }
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
    const key = getRequestKey(req);

    console.log('body is ', req.body);
    const message = req.body;

    return res.send(
      await sendMessageText(
        key,
        message.id_unique,
        message.from,
        message.to,
        message.body
      )
    );
  }
);

app.listen(5000, function() {
  console.log('App listening on port 5000!');
  createNextSession();
});


async function sendMessageText(key: string, id_unique: string, from: string, to: string, body: string) {
  const sessionid = from;
  const session = getSessionsBySessionId(key, sessionid);
  if (!session || !session.client) {
    return {
      cd_error: 1,
      ds_error: 'Instância não está ativa ou não localizada!',
    };
  }

  const states = await session.client.getConnectionState();
  if (states !== 'CONNECTED') {
    return {
      cd_error: 2,
      ds_error: 'Instância está em modo ' + states,
    };
  }
  const jid = cuidToJid(to);

  
  let contact;
  contact = await session.client.checkNumberStatus(jid);
  console.log('contact = ', contact);
  if (!contact || contact === 404 || contact.status !== 200 || !contact.numberExists) {
    return {
      cd_error: 3,
      ds_error: 'Whatsapp ' + to + ' não localizado.',
    };
  }else{
    if (!contact.canReceiveMessage){
      return {
        cd_error: 3,
        ds_error: 'Whatsapp ' + to + ' não pode receber mensagens.',
      };
    }
  }

  const newMessage = await session.client.sendText(contact.id._serialized, body);
  if (newMessage) {
    try {
      await insertMessage(
        body,
        from,
        to,
        id_unique,
        newMessage
      );
      return ({ cd_error: 0, id: newMessage });
    } catch (error) {
      return ({
        cd_error: 999,
        ds_error: error,
      });
    }
  } else {
    return ({
      cd_error: 3,
      ds_error: 'Whatsapp ' + to + ' não localizado.',
    });
  }
  
}


function formatWhatsNumberAndContryCode(to: string, default_contry: string = '55'){
  // verifica se existe o contry code
  if (to && to.length <= 11){
    to = default_contry + to; 
  }
  //possui 9 digito a mais.
  if (to && to.length == 13) {
    to = to.substring(0, 4) + to.substring(5);
  }

  return to;
}

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

function postPollRespostaAutomatica(value: RequisicaoRespostaWhatsapp) {

  const data = {
    RequisicaoRespostas: [
      {
        Cd_Requisicao: value.Cd_Requisicao,
        Respostas: [],
      },
    ],
  };

  value.Respostas.forEach((resposta) => {
    data.RequisicaoRespostas[0].Respostas.push({
      Cd_Requisicao: value.Cd_Requisicao,
      Ds_Resposta: resposta.Ds_Resposta,
      Dt_Resposta: `\/Date(${resposta.Dt_Resposta.getTime()})\/`,
      Nr_Envio: resposta.Nr_Envio,
    });
  })
  
  return new Promise((resolve, reject ) => {
    request.post(
      'http://sms.prospexti.com.br/WcfServiceSMSGateway.svc/rest/RequisitarPollEnvioRespostaAutomatica',
      { json: data },
      function (error, response, body) {
        try {
          if (!error && response.statusCode == 200) {
            return resolve(body);
          } else {
            if (error) {
              return reject(error);
            } else {
              return reject({ code: response.statusCode });
            }
          }  
        } catch (error) {
          return reject({ code: 99, ds_error: error });
        }
      }
    );
  });
}
