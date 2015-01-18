/**
 * # Doxxo
 *     
 *     Copyright (c) 2015 Beneath the Ink, Inc.
 *     MIT License
 *
 * A quick-and-dirty documentation generator inspired by [Docco](http://jashkenas.github.com/docco/). Unlike Docco, Doxxo parses block-level comments to find documentation, leaving inline comments where they belong.
 */

// dependencies
var _ = require('underscore'),
	Promise = require("bluebird"),
	fs = Promise.promisifyAll(require("fs")),
	cpr = Promise.promisify(require('cpr')),
	path = require('path'),
	marked = require('marked'),
	highlightjs = require('highlight.js'),
	dox = require("dox"),
	commondir = require('commondir'),
	mkdirp = Promise.promisify(require("mkdirp"));

// obtain built-in layouts directory and names
var cwd = process.cwd(),
	layout_dir = path.resolve(__dirname, "../layouts"),
	layouts = fs.readdirSync(layout_dir);

var Doxxo =
module.exports = function(paths, opts, callback) {
	// the fast, easy way to run doxxo
	if (!(this instanceof Doxxo)) {
		return new Doxxo(paths, opts).document(callback);
	}

	// normalize paths argument
	paths = !_.isArray(paths) ? paths != null ? [ paths ] : [] : paths;

	// prep options
	this.options = opts = Doxxo.configure(opts);

	// convert paths array into source objects
	this.sources = Doxxo.resolveSources(paths, opts.output, opts.index);

	// must have at least one source
	if (!this.sources.length) throw new Error("No valid sources provided.");
}

Doxxo.defaults = {
	output: "docs",
	layout: "bti",
	template: "Doxxo.jst",
	assets: true,
	index: null,
	silent: true,
	marked: {
		smartypants: true,
		breaks: false,
		highlight: function(code, lang) {
			if (highlightjs.getLanguage(lang)) {
				return highlightjs.highlight(lang, code).value;
			} else {
				return code;
			}
		}
	}
}

Doxxo.configure = function(opts) {
	opts = _.defaults(opts ? _.clone(opts) : {}, Doxxo.defaults);
	opts.output = path.resolve(opts.output);
	opts.index = opts.index && path.resolve(opts.index);
	opts.layout = Doxxo.resolveLayout(opts.layout);
	opts.template = Doxxo.resolveTemplate(opts.layout, opts.template);
	opts.log = function() {
		if (opts.silent) return;
		var args = _.toArray(arguments);
		if (typeof args[0] === "string") args[0] = "doxxo: " + args[0];
		return console.log.apply(console, args);
	}
	return opts;
}

Doxxo.resolveLayout = function(layout) {
	// look for built-in layout
	if (_.contains(layouts, layout)) return path.join(layout_dir, layout);

	// look up as the name of a folder
	try {
		var fpath = path.resolve(layout);
		if (fs.statSync(fpath).isDirectory()) return fpath;
	} catch(e) {}

	throw new Error("Not a valid layout: '" + layout + "'");
}

Doxxo.resolveTemplate = function(dir, template) {
	var fpath = path.resolve(dir, template),
		valid = false;

	try { valid = fs.statSync(fpath).isFile(); }
	catch(e) {}

	if (!valid) {
		throw new Error("Template file '" + template + "' is missing.");
	}

	return _.template(fs.readFileSync(fpath, "utf-8"));
}

Doxxo.resolveSources = function(paths, output, index) {
	// clean paths
	paths = Doxxo.cleanPaths(paths);

	// obtain the common directory
	var common = commondir("/", _.values(paths)).substr(1);
	
	// return an array of source objects
	return _.map(paths, function(src, fp) {
		var isIndex, outpath;

		outpath = (isIndex = fp === index) ? "index" :
			src.substr(0, src.length - path.extname(src).length).substr(common.length);

		return {
			full: fp,
			out: path.join(output, outpath + ".html"),
			name: src,
			isIndex: isIndex
		}
	});
}

Doxxo.cleanPaths = function(paths, strip, out) {
	return paths.reduce(function(memo, src) {
		var fpath, stat;

		src = path.normalize(src);
		fpath = path.resolve(src);
		stat = fs.statSync(fpath);

		if (stat.isFile()) {
			if (strip == null) src = path.basename(src);

			else if (src.substr(0, strip.length) === strip) {
				src = src.substr(strip.length);
				while (src[0] === "/") src = src.substr(1);
			}

			memo[fpath] = src;
		}
		
		else if (stat.isDirectory()) {
			Doxxo.cleanPaths(fs.readdirSync(fpath).map(function(f) {
				return path.join(src, f);
			}), strip != null ? strip : src, memo);
		}

		return memo;
	}, out || {});
}

Doxxo.parse = function(code, type) {
	var parser = Doxxo.parsers.byType(type);
	return _.isFunction(parser) ? parser(code) : [];
}

Doxxo.parsers = {
	js: function(code) {
		var comments, lines, sections, comment, nextComment, codeEnd, code;

		comments = dox.parseComments(code, { raw: true });
		if (!comments.length) return [];

		lines = code.split("\n");
		sections = [{
			codeText: lines.slice(0, comments[0].line - 1).join('\n'),
			docsText: ''
		}];

		for (var i = 0; i < comments.length; i++) {
			comment = comments[i];
			nextComment = comments[i + 1];
			codeEnd = nextComment != null ? nextComment.line - 1 : lines.length;
			code = lines.slice(comment.codeStart - 1, codeEnd);

			// replace tabs with 4 spaces
			code = code.map(function(line) {
				return line.replace(/^\t+/, function(m) {
					return _.times(m.length, function() { return "    "; }).join("");
				});
			});

			sections.push({
				docsText: comment.description.full,
				codeText: code.join("\n")
			});
		}

		return sections;
	},

	md: function(code) {
		return [{
			codeText: "",
			docsText: code
		}];
	},

	byType: function(type) {
		// support extensions as type
		if (type[0] === ".") type = type.substr(1);
		return Doxxo.parsers[type] || null;
	}
}

Doxxo.prototype.document = function(callback) {
	var self = this,
		opts = this.options;

	// parse sources and filter out the empties
	return this.parseSources().then(function(sources) {
		// do nothing if there are no sources
		if (!sources.length) return;

		// create the output directory
		return mkdirp(opts.output)

		// copy layout assets if specified
		.then(function() {
			if (opts.assets) return self.copyLayoutAssets();
		})

		// process and write each source
		.then(function() {
			return Promise.each(sources, self.write.bind(self), { concurrency: 1 });
		});
	})

	// for the old-school asyncs
	.nodeify(callback);
}

Doxxo.prototype.parseSources = function() {
	// parse sources and filter out the empties
	return Promise.resolve(this.sources).bind(this).filter(function(src) {
		// check the type is supported
		if (!Doxxo.parsers.byType(path.extname(src.full))) {
			this.options.log("Unsupported file type: '%s'", path.relative(cwd, src.full));
			return false;
		}

		// grab file contents
		return fs.readFileAsync(src.full, "utf-8")

		// parse code into sections
		.then(function(code) {
			var sections = src.sections = Doxxo.parse(code, path.extname(src.full));
			
			// remove sources with empty sections
			return sections && sections.length;
		});
	})

	// set the new sources array
	.tap(function(sources) {
		this.sources = sources;
	});
}

Doxxo.prototype.copyLayoutAssets = function() {
	var from = path.join(this.options.layout, "public"),
		to = path.join(this.options.output, "public");

	// check that it exists and is a directory
	return fs.statAsync(from).bind(this)

	// copy the folder
	.then(function(stat) {
		if (stat.isDirectory()) return cpr(from, to, {
			deleteFirst: false,
			overwrite: true,
			confirm: false
		});
	}, function(e) {
		if (e.code !== "ENOENT") throw e;
	})

	// log when finished
	.then(function() {
		this.options.log("Copied layout assets to '%s'", path.relative(cwd, to));
	});
}

Doxxo.prototype.write = function(source) {
	// make any leading directories
	return mkdirp(path.dirname(source.out)).bind(this)

	// format and write
	.then(function() {
		return fs.writeFileAsync(source.out, this.format(source));
	})

	// log when finished
	.then(function() {
		this.options.log("%s -> %s", path.relative(cwd, source.full), path.relative(cwd, source.out));
	});
}

Doxxo.prototype.format = function(source) {
	var firstSection, first, hasTitle, html,
		opts = this.options,
		sections = source.sections,
		outdir = path.dirname(source.out);

	function destination(file) {
		if (_.isObject(file)) file = file.out;
		return path.relative(outdir, path.resolve(opts.output, file));
	}

	sections.forEach(function(section) {
		var code = highlightjs.highlight("javascript", section.codeText).value;
		code = code.replace(/\s+$/, '');
		section.codeHtml = "<div class='highlight'><pre>" + code + "</pre></div>";
		section.docsHtml = marked(section.docsText, opts.marked);
		return section;
	});

	firstSection = _.find(sections, function(section) {
		return section.docsText.length > 0
	});

	if (firstSection) first = marked.lexer(firstSection.docsText)[0];
	hasTitle = first && first.type === 'heading' && first.depth === 1;

	return opts.template({
		source: source,
		sources: this.sources,
		title: hasTitle ? first.text : source.name,
		hasTitle: hasTitle,
		sections: sections,
		path: path,
		destination: destination,
		options: opts
	});
}