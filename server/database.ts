const mysql = require('mysql');

export class Database {
  private connection: any = null;
  
  constructor(config) {
    this.connection = mysql.createPool(config);
  }

  query(sql: string, args?: any) {
    return new Promise((resolve, reject) => {
      this.connection.query(sql, function (err, result) {
        if (err) {
          return reject(err);
        }
        return resolve(result);
      });  
    });
  }

  public close() {
    if (this.connection) {
      this.connection.release();
      this.connection = null;
    }
  }
}
