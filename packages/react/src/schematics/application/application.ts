import { join, normalize } from '@angular-devkit/core';
import {
  chain,
  Rule,
  Tree,
  SchematicContext,
  mergeWith,
  apply,
  template,
  move,
  url,
  externalSchematic,
  noop,
  filter
} from '@angular-devkit/schematics';
import { Schema } from './schema';
import {
  updateJsonInTree,
  NxJson,
  toFileName,
  names,
  offsetFromRoot,
  getNpmScope,
  formatFiles
} from '@nrwl/workspace';
import ngAdd from '../ng-add/ng-add';

interface NormalizedSchema extends Schema {
  projectName: string;
  appProjectRoot: string;
  e2eProjectName: string;
  e2eProjectRoot: string;
  parsedTags: string[];
}

function createApplicationFiles(options: NormalizedSchema): Rule {
  return mergeWith(
    apply(url(`./files/app`), [
      template({
        ...options,
        ...names(options.name),
        tmpl: '',
        offsetFromRoot: offsetFromRoot(options.appProjectRoot)
      }),
      options.unitTestRunner === 'none'
        ? filter(file => file !== '/src/app/app.spec.tsx')
        : noop(),
      move(options.appProjectRoot)
    ])
  );
}

function updateNxJson(options: NormalizedSchema): Rule {
  return updateJsonInTree<NxJson>('nx.json', json => {
    json.projects[options.projectName] = { tags: options.parsedTags };
    return json;
  });
}

function addProject(options: NormalizedSchema): Rule {
  return updateJsonInTree('angular.json', json => {
    const architect: { [key: string]: any } = {};

    architect.build = {
      builder: '@nrwl/web:build',
      options: {
        outputPath: join(normalize('dist'), options.appProjectRoot),
        index: join(normalize(options.appProjectRoot), 'src/index.html'),
        main: join(normalize(options.appProjectRoot), 'src/main.tsx'),
        polyfills: join(normalize(options.appProjectRoot), 'src/polyfills.ts'),
        tsConfig: join(normalize(options.appProjectRoot), 'tsconfig.app.json'),
        assets: [
          join(normalize(options.appProjectRoot), 'src/favicon.ico'),
          join(normalize(options.appProjectRoot), 'src/assets')
        ],
        styles: [
          join(normalize(options.appProjectRoot), `src/styles.${options.style}`)
        ],
        scripts: []
      },
      configurations: {
        production: {
          fileReplacements: [
            {
              replace: join(
                normalize(options.appProjectRoot),
                `src/environments/environment.ts`
              ),
              with: join(
                normalize(options.appProjectRoot),
                `src/environments/environment.prod.ts`
              )
            }
          ],
          optimization: true,
          outputHashing: 'all',
          sourceMap: false,
          extractCss: true,
          namedChunks: false,
          extractLicenses: true,
          vendorChunk: false,
          budgets: [
            {
              type: 'initial',
              maximumWarning: '2mb',
              maximumError: '5mb'
            }
          ]
        }
      }
    };

    architect.serve = {
      builder: '@nrwl/web:dev-server',
      options: {
        buildTarget: `${options.projectName}:build`
      },
      configurations: {
        production: {
          buildTarget: `${options.projectName}:build:production`
        }
      }
    };

    architect.lint = {
      builder: '@angular-devkit/build-angular:tslint',
      options: {
        tsConfig: [
          join(normalize(options.appProjectRoot), 'tsconfig.app.json')
        ],
        exclude: ['**/node_modules/**']
      }
    };

    json.projects[options.projectName] = {
      root: options.appProjectRoot,
      sourceRoot: join(normalize(options.appProjectRoot), 'src'),
      projectType: 'application',
      schematics: {},
      architect
    };
    return json;
  });
}

export default function(schema: Schema): Rule {
  return (host: Tree) => {
    const options = normalizeOptions(host, schema);

    return chain([
      ngAdd(),
      createApplicationFiles(options),
      updateNxJson(options),
      addProject(options),
      options.e2eTestRunner === 'cypress'
        ? externalSchematic('@nrwl/cypress', 'cypress-project', {
            ...options,
            name: options.name + '-e2e',
            directory: options.directory,
            project: options.projectName
          })
        : noop(),
      options.unitTestRunner === 'jest'
        ? externalSchematic('@nrwl/jest', 'jest-project', {
            project: options.projectName,
            supportTsx: true,
            skipSerializers: true,
            setupFile: 'none'
          })
        : noop(),
      formatFiles(options)
    ]);
  };
}

function normalizeOptions(host: Tree, options: Schema): NormalizedSchema {
  const appDirectory = options.directory
    ? `${toFileName(options.directory)}/${toFileName(options.name)}`
    : toFileName(options.name);

  const appProjectName = appDirectory.replace(new RegExp('/', 'g'), '-');
  const e2eProjectName = `${appProjectName}-e2e`;

  const appProjectRoot = `apps/${appDirectory}`;
  const e2eProjectRoot = `apps/${appDirectory}-e2e`;

  const parsedTags = options.tags
    ? options.tags.split(',').map(s => s.trim())
    : [];

  const defaultPrefix = getNpmScope(host);
  return {
    ...options,
    prefix: options.prefix ? options.prefix : defaultPrefix,
    name: toFileName(options.name),
    projectName: appProjectName,
    appProjectRoot,
    e2eProjectRoot,
    e2eProjectName,
    parsedTags
  };
}
