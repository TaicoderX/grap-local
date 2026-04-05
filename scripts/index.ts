import { connectToMongo, disconnectFromMongo } from '../src/db/mongo.js';
import { indexingService } from '../src/modules/indexing/indexing.service.js';
import { repositoryService } from '../src/modules/repo/repository.service.js';

const readArg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const main = async (): Promise<void> => {
  const repositoryPath = readArg('--path');
  const repositoryName = readArg('--name');

  if (!repositoryPath || !repositoryName) {
    throw new Error('Usage: npm run index -- --path ../some-repo --name my-repo');
  }

  await connectToMongo();

  const repository = await repositoryService.registerRepository({
    name: repositoryName,
    rootPath: repositoryPath
  });
  const result = await indexingService.indexRepository(repository._id.toString());

  console.log(
    JSON.stringify(
      {
        repository: {
          id: repository._id.toString(),
          name: repository.name,
          rootPath: repository.rootPath
        },
        result
      },
      null,
      2
    )
  );

  await disconnectFromMongo();
};

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await disconnectFromMongo();
  process.exit(1);
});
