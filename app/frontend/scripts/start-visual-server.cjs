const nextCli = require.resolve('next/dist/bin/next');

process.argv = [process.execPath, nextCli, 'dev', '-p', '3000', '-H', '0.0.0.0'];
require(nextCli);
