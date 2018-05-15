# Add to crontab -e
# */10 * * * * ~/priv/scripts/writeChain.sh
aws s3 sync ~/priv/data/geth/chaindata/ s3://fintechtoken.chain --exclude "LOCK"