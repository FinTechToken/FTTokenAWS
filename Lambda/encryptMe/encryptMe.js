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
    sha256 = require('js-sha256'),
    cryptAlgorithm = 'aes-256-ctr',
    hashAlgorithm = 'sha256',
    uuid = require('uuid/v4'),
    Base58 = require('base58-native'),
    biguint = require('big-integer'),
    ripemd160 = require('ripemd160'),
    ecdsa = require('elliptic').ec,
    password =  process.env.PASSWORD,
    key = process.env.HASH_KEY;

    var newUUID,
    ec = new ecdsa('secp256k1');

exports.handler = (event, context, callback) => {
    newUUID= uuid();
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
    else if(event.bitcoin)
      callback(null, getBitCoinAddress());
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

function getBitCoinAddress() {
  //add 0x80 to the front, https://en.bitcoin.it/wiki/List_of_address_prefixes
  console.log(newUUID);
  var maxKey = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140";
  var privateKey = getPrivateAddress(newUUID);
  console.log(privateKey);
  while(biguint(maxKey,16).compare(biguint(privateKey,16))<0) {
    newUUID = uuid();
    privateKey = getPrivateAddress(newUUID).substring(0,64);
  }

  var privateKeyAndVersion = "80" + privateKey;
  console.log(privateKeyAndVersion);
  var firstSHA = sha256(Buffer.from(privateKeyAndVersion,"hex"));
  console.log(firstSHA);
  var secondSHA = sha256(Buffer.from(firstSHA,"hex"));
  console.log(secondSHA);

  //var firstSHA = crypto.SHA256(privateKeyAndVersion);
  //var secondSHA = crypto.SHA256(firstSHA);
  var checksum = secondSHA.substr(0, 8).toUpperCase();
  console.log(checksum);

  //append checksum to end of the private key and version
  var keyWithChecksum = privateKeyAndVersion + checksum;
  console.log(keyWithChecksum);
  var privateKeyWIF = Base58.encode(Buffer.from(keyWithChecksum,"hex"));
  console.log(privateKeyWIF);
  var publicAddress = getPublicBitCoinAddress(privateKeyWIF);
  console.log(publicAddress);
  return {private: privateKeyWIF, public: publicAddress};
}

function privateKeyFromWIF(privateKeyWIF) {
  var privateKey =  Base58.decode(privateKeyWIF).toString('hex');
  return privateKey.substring(2,privateKey.length -8);
}

function getPublicBitCoinAddress(privateKeyWIF) {
  console.log("private:" + privateKeyWIF);
  var privateKey = privateKeyFromWIF(privateKeyWIF);
  console.log("privateKEY:" + privateKey);
  const keys = ec.keyFromPrivate(privateKey);
  const publicKey = keys.getPublic('hex');
  var hash = sha256(Buffer.from(publicKey, 'hex'));
  var publicKeyHash = new ripemd160().update(Buffer.from(hash, 'hex')).digest();
  // step 1 - add prefix "00" in hex
  var step1 = "00" + publicKeyHash.toString('hex');
  // step 2 - create SHA256 hash of step 1
  var step2 = sha256(Buffer.from(step1,"hex"));
  // step 3 - create SHA256 hash of step 2
  var step3 = sha256(Buffer.from(step2, 'hex'));
  // step 4 - find the 1st byte of step 3 - save as "checksum"
  var checksum = step3.substring(0, 8);
  // step 5 - add step 1 + checksum
  var step4 = step1 + checksum;
  // return base 58 encoding of step 5
  var address = Base58.encode(Buffer.from(step4, 'hex'));
  return address;
}

function getPrivateAddress(text) {
  return crypto.createHmac(hashAlgorithm, key).update(text).digest('hex');
}
