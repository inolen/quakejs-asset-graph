var DirectedGraph = require('./directed-graph');
var qkfiles = require('quakejs-files');
var path = require('path');

var ASSET = {
	AUDIO:   0,
	MAP:     1,
	AAS:     2,
	MODEL:   3,
	SCRIPT:  4,
	SKIN:    5,
	TEXTURE: 6,
	MISC:    7
};

function sanitize(p) {
	return p.toLowerCase().replace(/\\/g, '/');
}

function generalize(p, type) {
	// use generic extensions for audio, models and textures since the game
	// will load up any format matching the asset's basename
	if (type === ASSET.AUDIO) {
		p = p.replace(path.extname(p), '.audio');
	} else if (type === ASSET.MODEL) {
		p = p.replace(path.extname(p), '.model');
	} else if (type === ASSET.TEXTURE) {
		// textures are often referenced without an extension
		var ext = path.extname(p);
		p = ext ? p.replace(ext, '.texture') : (p + '.texture');
	}
	return p;
}

var AssetGraph = function() {
	this._graph = new DirectedGraph();
	// cache vertexes for each asset here for fast lookup by name
	this._assetverts = {};
	this._maps = [];
};

AssetGraph.ASSET = ASSET;
AssetGraph.prototype.ASSET = ASSET;

AssetGraph.prototype._addAsset = function (name, type) {
	var key = generalize(sanitize(name), type);

	var v = this._assetverts[key];

	if (!v) {
		v = this._graph.addVertex();
		v.data = { key: key, names: [], type: type };
		this._assetverts[key] = v;
	}

	if (v.data.names.indexOf(name) === -1) {
		v.data.names.push(name);
	}

	return v;
};

AssetGraph.prototype._addReference = function (a, b) {
	for (var i = 0; i < a.out_edges.length; i++) {
		if (a.out_edges[i].dest == b) {
			return;
		}
	}
	// console.log('adding reference from', a.data.name, 'to', b.data.name);
	return this._graph.addEdge(a, b);
};

AssetGraph.prototype._processScript = function (name, script) {
	var scriptAsset = this._addAsset(name, ASSET.SCRIPT);

	for (var key in script) {
		if (!script.hasOwnProperty(key)) {
			continue;
		}

		// treat shaders as a texture that references other textures
		var shaderAsset = this._addAsset(key, ASSET.TEXTURE);
		var shader = qkfiles.shader.loadShader(script[key]);

		// note: while scripts do contain shaders organizationally,
		// scripts are never referenced, therefor we model the
		// relationship as:
		//                             / - base_wall.shader
		// textures/base_wall/foobar -> -- textures/base_wall/foobar_stage1.tga
		//                             \ - textures/base_wall/foobar_stage2.tga
		this._addReference(shaderAsset, scriptAsset);

		for (var i = 0; i < shader.stages.length; i++) {
			var stage = shader.stages[i];
			for (var j = 0; j < stage.maps.length; j++) {
				var stageAsset = this._addAsset(stage.maps[j], ASSET.TEXTURE);
				this._addReference(shaderAsset, stageAsset);
			}
		}
	}

	return shaderAsset;
};

AssetGraph.prototype._processSkin = function (name) {
	var skinAsset = this._addAsset(name, ASSET.SKIN);

	// TODO process skin references

	return skinAsset;
};

AssetGraph.prototype._processModel = function (name, model) {
	var modelAsset = this._addAsset(name, ASSET.MODEL);

	for (var i = 0; i < model.skins.length; i++) {
		var skin = model.skins[i];
		if (!skin) {
			// models often have bad data, including empty skin / shader names
			continue;
		}
		var skinAsset = this._processSkin(skin);
		this._addReference(modelAsset, skinAsset);
	}

	for (var i = 0; i < model.surfaces.length; i++) {
		var surface = model.surfaces[i];

		for (var j = 0; j < surface.shaders.length; j++) {
			var texture = surface.shaders[j];
			if (!texture) {
				continue;
			}
			var textureAsset = this._addAsset(texture, ASSET.TEXTURE)
			this._addReference(modelAsset, textureAsset);
		}
	}

	return modelAsset;
};

AssetGraph.prototype._processMap = function (name, map) {
	var mapAsset = this._addAsset(name, ASSET.MAP);

	// add reference to .aas botfile
	var aas = mapAsset.data.key.replace('.bsp', '.aas');
	this._addReference(mapAsset, this._addAsset(aas, ASSET.AAS));

	// add reference to levelshot
	var levelshot = path.join('levelshots', path.basename(mapAsset.data.key).replace('.bsp', '.tga'));
	this._addReference(mapAsset, this._addAsset(levelshot, ASSET.TEXTURE));

	// process entities for asset references
	for (var i = 0; i < map.entities.length; i++) {
		var ent = map.entities[i];
		var assets = [];
		if (ent.music) {
			assets.push(this._addAsset(ent.music, ASSET.AUDIO));
		}
		if (ent.noise) {
			assets.push(this._addAsset(ent.noise, ASSET.AUDIO));
		}
		if (ent.model) {
			assets.push(this._addAsset(ent.model, ASSET.MODEL));
		}
		if (ent.model2) {
			assets.push(this._addAsset(ent.model2, ASSET.MODEL));
		}
		for (var j = 0; j < assets.length; j++) {
			this._addReference(mapAsset, assets[j]);
		}
	}

	// process shader lump for textures
	for (var i = 0; i < map.shaders.length; i++) {
		var textureAsset = this._addAsset(map.shaders[i].shaderName, ASSET.TEXTURE);
		this._addReference(mapAsset, textureAsset);
	}

	return mapAsset;
};

AssetGraph.prototype.maps = function () {
	return this._maps;
};

AssetGraph.prototype.filter = function (cb) {
	var results = [];
	var vertices = this._graph.vertices;

	for (var i = 0; i < vertices.length; i++) {
		var v = vertices[i];
		if (!cb(v)) {
			continue;
		}
		results.push(v);
	}

	return results;
};

AssetGraph.prototype.add = function (name, buffer) {
	var name = sanitize(name);
	var ext = path.extname(name);
	var v;

	if (ext === '.wav') {
		v = this._addAsset(name, ASSET.AUDIO);
	} else if (ext === '.bsp') {
		console.log('loading map', name);
		var map = qkfiles.bsp.load(buffer, { lumps: [qkfiles.bsp.LUMP.ENTITIES, qkfiles.bsp.LUMP.SHADERS] });
		v = this._maps[sanitize(name)] = this._processMap(name, map);
	} else if (ext === '.aas') {
		v = this._addAsset(name, ASSET.AAS);
	} else if (ext === '.md3') {
		console.log('loading model', name);
		var model = qkfiles.md3.load(buffer);
		v = this._processModel(name, model);
	} else if (ext === '.shader') {
		console.log('loading shader', name);
		var script = qkfiles.shader.loadScript(buffer.toString('utf8'));
		v = this._processScript(name, script);
	} else if (ext === '.skin') {
		v = this._addAsset(name, ASSET.SKIN);
	} else if (ext === '.jpg' || ext === '.tga') {
		v = this._addAsset(name, ASSET.TEXTURE);
	} else {
		v = this._addAsset(name, ASSET.MISC);
	}

	return v;
};

module.exports = AssetGraph;