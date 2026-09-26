const fs = require('fs');
const path = require('path');
const { IOSConfig, withXcodeProject } = require('expo/config-plugins');

const FILE = 'LogCardPayment.swift';

// App Intents must be compiled into the app target for Shortcuts to discover them.
module.exports = function withCardPayments(config) {
  return withXcodeProject(config, (cfg) => {
    const group = cfg.modRequest.projectName;
    fs.copyFileSync(require.resolve(`./${FILE}`), path.join(cfg.modRequest.platformProjectRoot, group, FILE));
    if (!cfg.modResults.hasFile(`${group}/${FILE}`)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: `${group}/${FILE}`, groupName: group, project: cfg.modResults });
    }
    return cfg;
  });
};
