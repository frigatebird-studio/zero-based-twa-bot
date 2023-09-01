import path, {join} from 'path';
import * as yaml from 'js-yaml';
import {readFileSync} from 'fs';

const configPath = path.join(__dirname, '../config');

const appConfig = yaml.load(
  readFileSync(join(configPath, 'app.yaml'), 'utf8')
) as AirDrop.Config.App;

const config = {
  app: appConfig,
};

export default config;
