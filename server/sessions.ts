import { Whatsapp } from '../src';

export class SessionWhatsapp {
  constructor(public session: string, public client: Whatsapp) {
    this.session = session;
    this.client = client;
  }
}

export class RespostasWhatsapp {
  constructor(public Ds_Resposta: string,public Dt_Resposta: Date, public Nr_Envio: string) {
    this.Ds_Resposta = Ds_Resposta;
    this.Dt_Resposta = Dt_Resposta;
    this.Nr_Envio = Nr_Envio;
  }
}


export class RequisicaoRespostaWhatsapp {
  constructor() {}
  public Cd_Requisicao: string;
  public Respostas: RespostasWhatsapp[] = [];
}



