'use strict';
/*
  { account: PublicEtherAddress, token: FTToken_Token, contractName, contractABI, publishedAddress } // Publish contract

  { token: FTToken_Token, address: (tokenAddress OR AuthorAddress) } //get array - publishedAddress/authorAddress, contractName, contractVer, contractABI 

  ToDo: send in solidity code and compile/publish server side.
  ToDo: Make all addresses lowercase.
*/
var AWS = require('aws-sdk'),
  documentClient = new AWS.DynamoDB.DocumentClient(),
  now,
  twentyMinutesAgo,
  respondToRequest, 
  request,
  index;

exports.publishContract = function(event, context, callback) {
  respondToRequest = callback;
  request = event;
  index=0;
  now = new Date();
  twentyMinutesAgo = new Date();
  twentyMinutesAgo.setMinutes(now.getMinutes() - 20);
	if(putRequestHasProperFormat(event)) {
    documentClient.get(searchForToken(), publishContractIfAccountTokenMatch);		
	} else if(getRequestHasProperFormat(event)) {
    documentClient.get(searchForToken(), getContractsIfValidToken);
  } else {
    callback('Not Proper Format', null);
  }
};

function putRequestHasProperFormat(event) {
	if(!event.account || !event.token || !event.contractName || !event.contractABI || !event.publishedAddress || event.contractName.includes(':'))
		return false;
	return true;
}

function getRequestHasProperFormat(event) {
	if(event.token && event.address)
		return true;
	return false;
}

function searchForToken() {
	return {
		TableName: process.env.TABLE_NAME_TOKEN,
		Key: {
			[process.env.KEY_NAME_TOKEN]: request.token
		}
	};
}

function getContractsIfValidToken(err, data) {
  if(err)
    respondToRequest('DB Error', null);
  else if(isRecentToken(data.Item.aTokenDate)) {
    getContracts();
  } else
    respondToRequest('DB Error', null);
}

  function getContracts() {
    documentClient.query(getContractsToReturn(), respondWithContracts);
  }

    function getContractsToReturn() {
      return {
        TableName: 'Contracts',
        KeyConditionExpression: 'PublicAddress = :a',
        ExpressionAttributeValues: {
          ':a': request.address
        }
      };
    }

    function respondWithContracts(err, data) {
      if(err)
        respondToRequest('DB Error', null);
      else {
        respondToRequest(null, data.Items);
      }
    }
 
function publishContractIfAccountTokenMatch(err, data) {
	if(err)
		respondToRequest('DB Error', null);
	else if(isAccountTokenMatch(data.Item))
    getAccountAndPublishContract(data.Item);
  else
    respondToRequest('DB Error', null);
}

  function isAccountTokenMatch(item) {
    return(item && item[process.env.KEY_NAME] == request.account && item.aTokenDate);
  }

  function getAccountAndPublishContract(tokens) {
    if(isRecentToken(tokens.aTokenDate))
      publishContract();
    else
      respondToRequest('DB Error', null);
  }

    function isRecentToken(tokenDate) {
      if(twentyMinutesAgo.toISOString() < tokenDate)
        return true;
      return false;
    }

    function publishContract() {
      documentClient.query(getContractVer(), incrementVersionAndPublishContract);
    }

      function getContractVer() {
        return {
          TableName: 'Contracts',
          KeyConditionExpression: 'PublicAddress = :a and begins_with(ContractNameVer, :b)',
          ExpressionAttributeValues: {
            ':a': request.account,
            ':b': request.contractName + ':'
          }
        };
      }

      function incrementVersionAndPublishContract(err, data) {
        if(err)
          respondToRequest('DB Error', null);
        else {
         if(data.Count) {
          index = getMax(data);
         }
         if(isDuplicate(data))
          respondToRequest('Duplicate');
         else
          documentClient.put(putContract(), writeAuther);
        }
      }

        function writeAuther(err, data) {
          if(err)
            respondToRequest('DB Error', null);
          else 
            documentClient.put(putContractAuthor(), response);
        }

        function response(err, data) {
          if(err)
            respondToRequest('DB Error', null);
          else
            respondToRequest(null, true);
        }
      
        function isDuplicate(data) {
          let j=0;
          while(j<data.Count){
            if(data.Items[j].PublishedAddress==request.publishedAddress)
              return true;
            j++;
          }
          return false;
        }

        function getMax(data) {
          let max = 0;
          let i = 0;
          while(i<data.Count) {
            if(data.Items[i].ContractNameVer.split(':')[1] > max){
              max = data.Items[i].ContractNameVer.split(':')[1];
            }
            i++;
          }
          return +max+1;
        }

        function putContract() {
          return {
            TableName: 'Contracts',
            Item: {
              PublicAddress: request.publishedAddress,
              ContractNameVer: request.contractName + ':' + index,
              ContractABI: JSON.stringify(request.contractABI),
              AuthorAddress: request.account
            }
          };
        }

        function putContractAuthor() {
          return {
            TableName: 'Contracts',
            Item: {
              PublicAddress: request.account,
              ContractNameVer: request.contractName + ':' + index,
              ContractABI: JSON.stringify(request.contractABI),
              PublishedAddress: request.publishedAddress
            }
          };
        }
