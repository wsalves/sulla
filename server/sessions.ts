import { Whatsapp } from '../src';

export class SessionWhatsapp {
  constructor(public session: string, public client: Whatsapp) {
    this.session = session;
    this.client = client;
  }
}
