/**
 * Verifies the built package the way n8n consumes it: read the `n8n` manifest
 * from package.json, require each file it declares, and instantiate the class.
 *
 * This catches the failures that only show up after publishing — a node file
 * missing from `files`, an icon that never got copied into dist/, a credential
 * name the node references but nothing provides.
 *
 * Run against the source tree (`npm run verify`) or against an installed copy
 * by running it from inside node_modules/n8n-nodes-apiosk.
 *
 * `n8n-workflow` is supplied by the n8n host at runtime, not by this package,
 * so requiring a node file needs it on NODE_PATH — `npm run verify` sets that
 * up from the local devDependency.
 */
const path = require('path');
const fs = require('fs');

const root = process.cwd();
const pkg = require(path.join(root, 'package.json'));

let failed = 0;
const check = (label, fn) => {
	try {
		fn();
		console.log('  ok   ' + label);
	} catch (error) {
		console.log('  FAIL ' + label + ' -> ' + error.message);
		failed++;
	}
};

const loadSingleExport = (relPath) => {
	const mod = require(path.join(root, relPath));
	const names = Object.keys(mod);
	if (names.length !== 1) throw new Error('expected one export, got: ' + names.join(', '));
	return new mod[names[0]]();
};

const credentialNames = pkg.n8n.credentials.map((rel) => loadSingleExport(rel).name);

for (const rel of pkg.n8n.nodes) {
	console.log(rel);
	check('file is present', () => {
		if (!fs.existsSync(path.join(root, rel))) throw new Error('not shipped — check "files"');
	});
	const node = loadSingleExport(rel);
	const d = node.description;

	check('description is complete', () => {
		for (const field of ['name', 'displayName', 'version', 'description', 'defaults']) {
			if (!d[field]) throw new Error('missing ' + field);
		}
	});
	check('outputs match outputNames', () => {
		if (d.outputNames && d.outputs.length !== d.outputNames.length) {
			throw new Error(d.outputs.length + ' outputs vs ' + d.outputNames.length + ' names');
		}
	});
	check('icon is shipped', () => {
		if (!d.icon) return;
		const icon = path.join(path.dirname(path.join(root, rel)), d.icon.replace(/^file:/, ''));
		if (!fs.existsSync(icon)) throw new Error('icon missing from dist: ' + d.icon);
	});
	check('credentials resolve', () => {
		for (const cred of d.credentials ?? []) {
			if (!credentialNames.includes(cred.name)) throw new Error('no credential named ' + cred.name);
		}
	});
	check('execute is implemented', () => {
		if (typeof node.execute !== 'function') throw new Error('execute is not a function');
	});
}

for (const rel of pkg.n8n.credentials) {
	console.log(rel);
	check('file is present', () => {
		if (!fs.existsSync(path.join(root, rel))) throw new Error('not shipped — check "files"');
	});
	const cred = loadSingleExport(rel);
	check('credential is complete', () => {
		if (!cred.name || !cred.displayName) throw new Error('missing name/displayName');
		if (!Array.isArray(cred.properties) || cred.properties.length === 0) {
			throw new Error('no properties');
		}
	});
}

console.log('package.json');
check('main entry resolves', () => require.resolve(path.join(root, pkg.main)));
check('no runtime dependencies', () => {
	const deps = Object.keys(pkg.dependencies ?? {});
	const peers = Object.keys(pkg.peerDependencies ?? {});
	if (deps.length || peers.length) {
		throw new Error('n8n installs these onto the host: ' + [...deps, ...peers].join(', '));
	}
});
check('has the community-node keyword', () => {
	if (!(pkg.keywords ?? []).includes('n8n-community-node-package')) {
		throw new Error('missing n8n-community-node-package keyword');
	}
});

console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall checks passed');
process.exit(failed ? 1 : 0);
