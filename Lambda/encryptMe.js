'use strict';

const crypto = require('crypto'),
    cryptAlgorithm = 'aes-256-ctr',
    hashAlgorithm = 'sha256',
    password =  process.env.PASSWORD,
    key = process.env.HASH_KEY;

exports.handler = (event, context, callback) => {
    if(event.encrypt)
      callback(null, encrypt(event.encrypt));
    else if(event.decrypt)
      callback(null, decrypt(event.decrypt));
    else if(event.getHash)
      callback(null, getHash(event.getHash));
    else
      callback('Needs encrypt, decrypt, or getHash', null);
};

function encrypt(text){
  return crypto.createCipher(cryptAlgorithm,password).update(text,'utf8','hex');
}
 
function decrypt(text){
  return crypto.createDecipher(cryptAlgorithm,password).update(text,'hex','utf8');
}

function getHash(text){
  return crypto.createHmac(hashAlgorithm, key).update(text).digest('hex');
}
