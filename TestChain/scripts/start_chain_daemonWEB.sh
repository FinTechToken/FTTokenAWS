#!/bin/sh
PORT=30303
RPCPORT=8090
WSPORT=8000
NETWORKID=913945103463586943
IDENTITY="@FTT_WEB#"
DATADIR=/home/$USER/priv/data
NAT=none
RPCADDR="0.0.0.0"
CACHE=2048

nohup geth --verbosity 2 --ws --wsorigins="*" --wsport $WSPORT --wsaddr $RPCADDR --rpc --rpccorsdomain "*" --rpcport $RPCPORT --rpcaddr $RPCADDR --gasprice 0 --port $PORT --networkid $NETWORKID --datadir $DATADIR --nat $NAT --identity $IDENTITY --nodiscover --cache $CACHE --syncmode "full" --gcmode "archive" --targetgaslimit 21000000 &
