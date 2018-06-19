'use strict';
/*
  { encrypt: StringToEncrypt }
  { decrypt: StringToDecrypt }
  { getHash: StringToHash }
  { sha3: StringToKeccak256Hash }
  { getRandomBytes: NumberBytes }
*/
const crypto = require('crypto'),
    keccak256 = require('js-sha3').keccak256,
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
    else if(event.getRandomBytes)
      callback(null, getRandomBytes(event.getRandomBytes));   
    else if(event.sha3)
      callback(null, keccak256(event.sha3));
    else
      callback('Needs encrypt, decrypt, or getHash', null);
};

function encrypt(text) {
  return crypto.createCipher(cryptAlgorithm,password).update(text,'utf8','hex');
}
 
function decrypt(text) {
  return crypto.createDecipher(cryptAlgorithm,password).update(text,'hex','utf8');
}

function getHash(text) {
  return crypto.createHmac(hashAlgorithm, key).update(text).digest('hex');
}

function getRandomBytes(bytes) {
  return crypto.randomBytes(bytes);
}
