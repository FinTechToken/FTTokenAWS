'use strict';
/*
  { account: PublicEthereumAddress, token: FTToken_Token } // Responds With Any Unclaimed Sent Hashes AND Hashes Received { sent:[], received:[] }
  { account: PublicEthereumAddress, token: FTToken_Token, phone: PhoneToSendHashTo } // Creates and Responds with Hash
  { account: PublicEthereumAddress, token: FTToken_Token, phone: PhoneToSendHashTo, refer: true } // Creates and Responds with Hash IF unique phone
  { account: PublicEthereumAddress, token: FTToken_Token, deposit: true } // Creates an unprocessed deposit record
  { account: PublicEthereumAddress, token: FTToken_Token, bankTrans: true } // responds with all bank transactions
  { account: PublicEthereumAddress, token: FTToken_Token, homeAddress: value, name: value } // inserts homeAddress and name of user.
  { account: PublicEthereumAddress, token: FTToken_Token, import: true, crypto: cryptoIndex } // Creates an unprocessed import record/address or responds with existing one.
  // cryptoIndex ETH=1,BTC=2

  { master: PublicEthereumAddress, token: FTToken_Token, export: true, exportAddress: address, exportAccount: exportAccount, block: FTTblock, value: value, crypto: cryptoIndex } //Creates an unprocessed export record/address
  { master: PublicEthereumAddress, token: FTToken_Token, delete: Hash } //Hash that was fulfilled. (respond with referee:newAccount,referer:senderAccount) OR respond "Deleted"
  { master: PublicEthereumAddress, token: FTToken_Token, funded: Hash } //text phone and update Hash
  { master: PublicEthereumAddress, token: FTToken_Token, funded: Hash, refer: true } //text phone with invite message and update Hash
  { master: PublicEthereumAddress, token: FTToken_Token, withdrawAddress: address, withdrawAmount: amount, withdrawBlock: block } //text phone with invite message and update Hash
*/

const AWS = require('aws-sdk'),
  uuid = require('uuid/v4'),
  keccak256 = require('js-sha3').keccak256,
  sha256 = require('js-sha256'),
  Base58 = require('base58-native'),
  biguint = require('big-integer'),
  ripemd160 = require('ripemd160'),
  ecdsa = require('elliptic').ec,
  hashAlgorithm = 'sha256',
  key = process.env.HASH_KEY,
	crypto = require('crypto'),
  twilio = require('twilio'),
  ethUtils = require('ethereumjs-util'),
  password = process.env.PASSWORD,
  passwordOld = process.env.PASSWORDOLD;

  var client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN),
  documentClient = new AWS.DynamoDB.DocumentClient(),
  now,
  twentyMinutesAgo,
  cryptAlgorithm = 'aes-256-ctr',
  ec = new ecdsa('secp256k1'),
  newUUID,
  newHash,
  request,
  phone,
  respondToRequest,
  sender,
  referee,
  response = {sent:[], received:[]};

exports.handler = (event, context, callback) => {
    sender = null;
    referee = null;
    phone=null;
    newHash = null;
    response = {sent:[], received:[]};
    respondToRequest = callback;
    request = event;
    now = new Date();
    twentyMinutesAgo = new Date();
    twentyMinutesAgo.setMinutes(now.getMinutes() - 20);
    newUUID= uuid();

    if(isValidRequest())
      documentClient.get(searchForToken(), findAndRespondWithHash);
    else if(isValidMasterRequest())
      documentClient.get(searchForHash(), textPhoneAndUpdateHashORDeleteHash);
    else if(isValidMasterBankRequest())
      documentClient.query(searchForBank(), insertBank);
    else if(isValidMasterExportRequest())
      documentClient.get(searchForExport(), insertExportIfNotExist);
    else
      respondToRequest('Not Proper Format', null);
  }

  function isValidRequest() {
    return (request.account && request.token);
  }
  
  function isValidMasterRequest() {
    return (request.master == process.env.MASTER && request.token == process.env.MASTER_TOKEN && (request.funded || request.delete ) );
  } 

  function isValidMasterBankRequest() {
    return (request.master == process.env.MASTER && request.token == process.env.MASTER_TOKEN && request.withdrawAmount && request.withdrawAddress && request.withdrawBlock );
  } 

  function isValidMasterExportRequest() {
    return (request.master == process.env.MASTER && request.token == process.env.MASTER_TOKEN && request.export );
  } 

  function searchForToken() {
    return {
      TableName: process.env.TABLE_NAME_TOKEN,
      Key: {
        [process.env.KEY_NAME_TOKEN]: request.token
      }
    };
  }

  function searchForExport() {
    return {
      TableName: process.env.TABLE_NAME_CB,
      Key: {
        [process.env.KEY_NAME_CB]: "0x" + request.exportAccount,
        [process.env.KEY_NAME_CB2]: request.block
      }
    }
  }

  function searchForBank() {
    return {
      TableName: process.env.TABLE_NAME_CB,
      KeyConditionExpression: process.env.KEY_NAME_CB +' = :a and ' + process.env.KEY_NAME_CB2+' = :b',
      FilterExpression: "Withdraw=:c",
      ExpressionAttributeValues: {
        ':a': request.withdrawAddress,
        ':b': request.withdrawBlock,
        ':c': true
      }
    };
  }

  function insertExportIfNotExist(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else {
      if(data.Item)
        respondToRequest('AlreadyExist', null);
      else
        documentClient.put(insertExportTrans(), respondWithExportSuccess);
    }
  }

  function insertBank(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else {
      if(data.Count)
        respondToRequest('AlreadyExist', null);
      else
        documentClient.put(insertBankTrans(), respondWithBankSuccess);
    }
  }

  function insertBankTrans() {
    return {
      TableName: process.env.TABLE_NAME_CB,
      Item: {
        [process.env.KEY_NAME_CB]: request.withdrawAddress,
        [process.env.KEY_NAME_CB2]: request.withdrawBlock,
        Amount: request.withdrawAmount,
        Withdraw: true,
        Processed: false
      }
    };
  }

  function insertNewDeposit() {
    return {
      TableName: process.env.TABLE_NAME_CB,
      Item: {
        [process.env.KEY_NAME_CB]: "0x" + request.account,
        [process.env.KEY_NAME_CB2]: "0",
        Amount: "0",
        Deposit: true,
        Processed: false
      }
    };
  }

  function insertExportTrans() {
    return {
      TableName: process.env.TABLE_NAME_CB,
      Item: {
        [process.env.KEY_NAME_CB]: "0x" + request.exportAccount,
        [process.env.KEY_NAME_CB2]: request.block,
        ExportAddress: request.exportAddress,
        Amount: request.value,
        Export: true,
        Processed: false,
        Crypto: request.crypto
      }
    }
  }

  function insertNewImportAddress() {
    newHash = '';
    var PrivateAddress = '';
    if(request.crypto == 1) { // New Eth Key/Pair
      PrivateAddress = getPrivateEtherAddress(newUUID);
      newHash = getPublicEthAddress(PrivateAddress);
    } else if(request.crypto == 2) { // New BitCoin Key/Pair
      PrivateAddress = getPrivateBitCoinAddress();
      newHash = getPublicBitCoinAddress(PrivateAddress);
    }
    return {
      TableName: process.env.TABLE_NAME_CB,
      Item: {
        [process.env.KEY_NAME_CB]: "0x" + request.account,
        [process.env.KEY_NAME_CB2]: request.crypto,
        ImportAddress: newHash,
        [process.env.KEY_NAME_CB_PRIVATE]: encrypt(PrivateAddress),
        Amount: "0",
        Import: true,
        Processed: false
      }
    };
  }

  function respondWithBankSuccess(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else
      respondToRequest(null,'BankEntry');
  }

  function respondWithExportSuccess(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else 
      respondToRequest(null, 'ExportEntry');
  }

function findAndRespondWithHash(err, data) {
  if(err) 
    respondToRequest('DB Error', null);
  else if(isValidToken(data.Item)) {
    if(request.phone) {
      if(isValidPhone(request.phone)) {
        sender = data.Item[process.env.KEY_NAME];
        documentClient.query(doesPhoneExist(request.phone), createAndRespondWithNewHashIfNoPhone);
      }
      else
        respondToRequest('Not Proper Format', null);
    } else if(request.deposit || request.bankTrans || request.import) {
      documentClient.query(searchForDeposits(), getBankTransImportOrInsertDeposit);
    } else if(request.homeAddress && request.name) {
      documentClient.get(searchForAccount(), insertAddressIfBlank);
    } else {
      documentClient.query(searchForSentHash(), getSentHashAndGetPhoneAndRespondWithHash);
    }
  } else 
    respondToRequest('DB Error', null);
}

  function isValidToken(item) {
    return (item && item[process.env.KEY_NAME] == request.account && isTokenRecent(item.aTokenDate));
  }

    function isTokenRecent(tokenDate) {
      if(twentyMinutesAgo.toISOString() < tokenDate)
        return true;
      return false;
    }

    function isValidPhone(phone) {
      if(phone && +phone > 1000000000 && +phone < 9999999999)
        return true;
      return false;
    }

    function doesPhoneExist(phone) {
      return {
        TableName: process.env.TABLE_NAME_PHONE,
        KeyConditionExpression: process.env.KEY_NAME_PHONE +' = :a',
        ExpressionAttributeValues: {
          ':a': encryptOld(phone)
        }
      };
    }

  function searchForDeposits() {
    return {
      TableName: process.env.TABLE_NAME_CB,
      KeyConditionExpression: process.env.KEY_NAME_CB +' = :a',
      ExpressionAttributeValues: {
        ':a': '0x' + request.account
      }
    };
  }

  function getBankTransImportOrInsertDeposit(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else {
      if(request.import) {
        var cryptoTranExists = false;
        var cryptoTranAddress = '';
        if(data.Count) {
          data.Items.forEach( (importTran, index) => {
            if(importTran.Import && importTran[process.env.KEY_NAME_CB2] == request.crypto ) {
              cryptoTranExists = true;
              cryptoTranAddress = importTran.ImportAddress;
            }
          });
        }
        if(cryptoTranExists)
          respondToRequest(null,cryptoTranAddress);
        else
          documentClient.put(insertNewImportAddress(), respondWithNewHash);
      } else if(request.deposit) {
        var bankTranExists = false;
        if(data.Count) {
          data.Items.forEach( (bankTran, index) => {
            if(bankTran.Deposit && bankTran[process.env.KEY_NAME_CB2] == "0")
              bankTranExists = true;
          });
        }
        if(bankTranExists)
            respondToRequest('AlreadyExists', null);
        else
          documentClient.put(insertNewDeposit(), respondWithBankSuccess);
      } else if(request.bankTrans) {
        respondToRequest(null, data.Items);
      } else
        respondToRequest('DB Error', null);
    }
  }

  function insertAddressIfBlank(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else {
      if(data.Item && !data.Item.HomeAddress && !data.Item.MyName)
        documentClient.update(updateNewAddressName(), respondWithAddressSuccess);
      else
        respondToRequest('AlreadyExists', null);
    }
  }

  function createAndRespondWithNewHashIfNoPhone(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else {
      if(data.Count) {
        if(request.refer)
          respondToRequest('DB Error', null); //User exists
        else
          createAndRespondWithNewHash(false);
      }
      else
        documentClient.query(doesPhoneExistInHash(), createAndRespondWithNewHashIfNoPhoneHash);
    }
  }

    function doesPhoneExistInHash() {
      return {
        TableName: process.env.TABLE_NAME_HASH,
        IndexName: process.env.KEY_NAME_HASH_PHONE + '-index',
        KeyConditionExpression: process.env.KEY_NAME_HASH_PHONE + ' = :a',
        FilterExpression: "Refer=:b",
        ExpressionAttributeValues: {
          ':a': encrypt(request.phone),
          ':b': true
        }
      };
    }

    function createAndRespondWithNewHashIfNoPhoneHash(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else {
        if(data.Count) {
          if(request.refer)
            respondToRequest('DB Error', null); //User exists
          else
            createAndRespondWithNewHash(false);
        }
        else
          createAndRespondWithNewHash(true);
      }
    }

  function createAndRespondWithNewHash(refer) {
    documentClient.put(putNewHash(refer), respondWithNewHash);
  }

    function putNewHash(refer) {
      newHash = keccak256(newUUID);
      if(refer)
        return {
          TableName: process.env.TABLE_NAME_HASH,
          Item: {
            [process.env.KEY_NAME_HASH]: newHash,
            [process.env.KEY_NAME_HASH_SENDER]: encrypt(sender),
            [process.env.KEY_NAME_HASH_PHONE]: encrypt(request.phone),
            HashCreateDate: now.toISOString(),
            UUID: encrypt(newUUID),
            Refer: true
          }
        };
      else {
        return {
          TableName: process.env.TABLE_NAME_HASH,
          Item: {
            [process.env.KEY_NAME_HASH]: newHash,
            [process.env.KEY_NAME_HASH_SENDER]: encrypt(sender),
            [process.env.KEY_NAME_HASH_PHONE]: encrypt(request.phone),
            HashCreateDate: now.toISOString(),
            UUID: encrypt(newUUID)
          }
        };
      }
    }

    function respondWithNewHash(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else
        respondToRequest(null, newHash);
    }

  function searchForSentHash() {
    return {
      TableName: process.env.TABLE_NAME_HASH,
      IndexName: process.env.KEY_NAME_HASH_SENDER + '-index',
      KeyConditionExpression: process.env.KEY_NAME_HASH_SENDER + ' = :a',
      ExpressionAttributeValues: {
        ':a': encrypt(request.account)
      }
    };
  }

  function getSentHashAndGetPhoneAndRespondWithHash(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else {
      if(data.Count) {
        data.Items.forEach( (item, index) => {
          response.sent[index] = item[process.env.KEY_NAME_HASH];
        });
      }
      documentClient.get(searchForAccount(), getPhoneAndRespondWithHash);
    }
  }

    function searchForAccount() {
      return {
        TableName: process.env.TABLE_NAME,
        Key: {[process.env.KEY_NAME]: request.account}
      };
    }

    function getPhoneAndRespondWithHash(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else {
        if(data.Item[process.env.KEY_NAME_PHONE]) {
          documentClient.query(searchForGotHash(decryptOld(data.Item[process.env.KEY_NAME_PHONE])), respondWithHash);
        } else
        respondToRequest('DB Error', null);
      }
    }

      function searchForGotHash(phone) {
        return {
          TableName: process.env.TABLE_NAME_HASH,
          IndexName: process.env.KEY_NAME_HASH_PHONE + '-index',
          KeyConditionExpression: process.env.KEY_NAME_HASH_PHONE + ' = :a',
          FilterExpression: "Texted=:b",
          ExpressionAttributeValues: {
            ':a': encrypt(phone),
            ':b': true
          }
        };
      }

      function respondWithHash(err, data) {
        if(err)
          respondToRequest('DB Error', null);
        else {
          if(data.Count) {
            data.Items.forEach( (item, index) => {
              response.received[index] = decrypt(item[process.env.KEY_NAME_HASH_KEY]);
            });
          }
          respondToRequest(null, response);
        }
      }

function searchForHash() {
  let hash = request.funded ? request.funded : request.delete;
  return {
    TableName: process.env.TABLE_NAME_HASH,
    Key: {[process.env.KEY_NAME_HASH]: hash}
  };
}

  function textPhoneAndUpdateHashORDeleteHash(err, data) {
    if(err)
      respondToRequest('DB Error', null);
    else if(data.Item) {
      if(request.funded) {
        phone = decrypt(data.Item[process.env.KEY_NAME_HASH_PHONE]);
        request.refer=data.Item.Refer;
        if(data.Item.Texted)
          respondToRequest('Already Funded', null);
        else
          documentClient.update(updateHashWithText(), sendTextAndRespondWithSuccess);
      } else if (request.delete) {
        documentClient.get(searchForHash(), respondWithSuccessOrReferInfo);
      } else
        respondToRequest('DB Error', null);
    } else
      respondToRequest('No Hash Found', null);
  }

    function respondWithSuccessOrReferInfo(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else if(data.Item.Refer) {
        sender=decrypt(data.Item.Sender);
        documentClient.query(doesPhoneExist(decrypt(data.Item.Phone)), deleteAndRespondWithReferInfo);
      } else
        documentClient.delete(searchForHash(), respondWithSuccess);
    }

    function deleteAndRespondWithReferInfo(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else if(data.Count) {
        referee = data.Items[0][process.env.KEY_NAME];
        documentClient.delete(searchForHash(), respondWithReferInfo);
      }
      else
        respondToRequest('DB Error', null);
    }

    function respondWithReferInfo(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else
        respondToRequest(null, "referer:" + sender + ":referee:" + referee);
    }

    function respondWithSuccess(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else
        respondToRequest(null,'Deleted');
    }

    function respondWithAddressSuccess(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else
        respondToRequest(null,'Inserted');
    }

    function updateNewAddressName() {
      return {
        TableName: process.env.TABLE_NAME,
        Key: {
          [process.env.KEY_NAME]: request.account
        },
        UpdateExpression: "SET HomeAddress=:b, MyName=:c",
        ExpressionAttributeValues:{
            ":b":encryptOld(request.homeAddress),
            ":c":encryptOld(request.name)
        }
      };
    }

    function updateHashWithText() {
      return {
        TableName: process.env.TABLE_NAME_HASH,
        Key: {
          [process.env.KEY_NAME_HASH]: request.funded
        },
        UpdateExpression: "SET Texted=:b, TextedDate=:c",
        ExpressionAttributeValues:{
            ":b":true,
            ":c":now.toISOString()
        }
      };
    }

    function sendTextAndRespondWithSuccess(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else {
        sendText();
      }
    }

    function sendText() {
      let msg='A friend sent you tokens. Get them at FinTechToken.com.';
      if(request.refer)
        msg='A friend invited you to FinTechToken.com. Take one minute to create an account, so you both get $5.'
      client.messages
      .create({
        to: '+1' + phone,
        from: process.env.TWILIO_FROM,
        body: msg
      })
      .then(message => {respondToRequest(null, 'Sent_Code')});
     respondToRequest(null, 'Sent_Code');
    }

function encrypt(text) {
  return crypto.createCipher(cryptAlgorithm,password).update(text,'utf8','hex');
}

function decrypt(text) {
  return crypto.createDecipher(cryptAlgorithm,password).update(text,'hex','utf8');
}

function encryptOld(text) {
  return crypto.createCipher(cryptAlgorithm,passwordOld).update(text,'utf8','hex');
}

function decryptOld(text) {
  return crypto.createDecipher(cryptAlgorithm,passwordOld).update(text,'hex','utf8');
}

function getPrivateEtherAddress(text) {
  return crypto.createHmac(hashAlgorithm, key).update(text).digest('hex');
}

function getPublicEthAddress(key) {
  //var publicKey = ethUtils.privateToPublic('0x'+key).toString('hex');
  return ethUtils.privateToAddress('0x'+key).toString('hex');
}

function getPrivateBitCoinAddress() {
  var maxKey = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140";
  var privateKey = getPrivateEtherAddress(newUUID);
  while(biguint(maxKey,16).compare(biguint(privateKey,16))<0) {
    newUUID = uuid();
    privateKey = getPrivateEtherAddress(newUUID).substring(0,64);
  }
  //add 0x80 to the front, https://en.bitcoin.it/wiki/List_of_address_prefixes
  var privateKeyAndVersion = "80" + privateKey;
  var firstSHA = sha256(Buffer.from(privateKeyAndVersion,"hex"));
  var secondSHA = sha256(Buffer.from(firstSHA,"hex"));
  var checksum = secondSHA.substr(0, 8).toUpperCase();
  //append checksum to end of the private key and version
  var keyWithChecksum = privateKeyAndVersion + checksum;
  return Base58.encode(Buffer.from(keyWithChecksum,"hex"));
}

function privateKeyFromWIF(privateKeyWIF) {
  var privateKey =  Base58.decode(privateKeyWIF).toString('hex');
  return privateKey.substring(2,privateKey.length - 8);
}

function getPublicBitCoinAddress(privateKeyWIF) {
  var privateKey = privateKeyFromWIF(privateKeyWIF);
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