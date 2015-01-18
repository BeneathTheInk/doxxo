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

var doxxo =
module.exports = function(paths, opts, callback) {
	// normalize paths argument
	paths = !_.isArray(paths) ? paths != null ? [ paths ] : [] : paths;
	if (!paths.length) throw new Error("No filenames provided.");

	// prep options
	opts = doxxo.configure(opts);

	// convert paths array into source objects
	var sources = opts.sources = doxxo.resolveSources(paths, opts.output, opts.index);

	// create the output directory
	return mkdirp(opts.output)

	// copy layout assets
	.then(function() {
		if (!opts.assets) return;

		return doxxo.copyLayoutAssets(opts.layout, opts.output).then(function(to) {
			opts.log("Copied layout assets to '%s'", path.relative(cwd, to));
		});
	})

	// process each source file
	.then(function() {
		return Promise.each(sources, function(src) {
			return doxxo.document(src, opts).then(function(success) {
				if (success) opts.log("%s -> %s", path.relative(cwd, src.full), path.relative(cwd, src.out));
			}, function(e) {
				if (!/ParseError/.test(e.toString())) throw e;
				opts.log("Unsupported file type: '%s'", path.relative(cwd, src.full));
			});
		}, { concurrency: 1 });
	})

	// for the old-school asyncs
	.nodeify(callback);
}

doxxo.defaults = {
	output: "docs",
	layout: "bti",
	template: "doxxo.jst",
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

doxxo.configure = function(opts) {
	opts = _.defaults(opts ? _.clone(opts) : {}, doxxo.defaults);
	opts.output = path.resolve(opts.output);
	opts.index = opts.index && path.resolve(opts.index);
	opts.layout = doxxo.resolveLayout(opts.layout);
	opts.template = doxxo.resolveTemplate(opts.layout, opts.template);
	opts.log = function() {
		if (opts.silent) return;
		var args = _.toArray(arguments);
		if (typeof args[0] === "string") args[0] = "doxxo: " + args[0];
		return console.log.apply(console, args);
	}
	return opts;
}

doxxo.resolveLayout = function(layout) {
	// look for built-in layout
	if (_.contains(layouts, layout)) return path.join(layout_dir, layout);

	// look up as the name of a folder
	try {
		var fpath = path.resolve(layout);
		if (fs.statSync(fpath).isDirectory()) return fpath;
	} catch(e) {}

	throw new Error("Not a valid layout: '" + layout + "'");
}

doxxo.resolveTemplate = function(dir, template) {
	var fpath = path.resolve(dir, template),
		valid = false;

	try { valid = fs.statSync(fpath).isFile(); }
	catch(e) {}

	if (!valid) {
		throw new Error("Template file '" + template + "' is missing.");
	}

	return _.template(fs.readFileSync(fpath, "utf-8"));
}

doxxo.resolveSources = function(paths, output, index) {
	// clean paths
	paths = doxxo.cleanPaths(paths);

	// obtain the common directory
	var common = commondir("/", _.values(paths)).substr(1);
	
	// return an array of source objects
	return _.map(paths, function(src, fp) {
		var isIndex, name;

		name = (isIndex = fp === index) ? "index" :
			src.substr(0, src.length - path.extname(src).length).substr(common.length);

		return {
			full: fp,
			out: path.join(output, name + ".html"),
			short: src,
			isIndex: isIndex
		}
	});
}

doxxo.cleanPaths = function(paths, strip, out) {
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
			doxxo.cleanPaths(fs.readdirSync(fpath).map(function(f) {
				return path.join(src, f);
			}), strip != null ? strip : src, memo);
		}

		return memo;
	}, out || {});
}

doxxo.copyLayoutAssets = function(layout, output) {
	var from = path.join(layout, "public"),
		to = path.join(output, "public");

	// check that it exists and is a directory
	return fs.statAsync(from).then(function(stat) {
		if (stat.isDirectory()) return cpr(from, to, {
			deleteFirst: false,
			overwrite: true,
			confirm: false
		});
	}, function(e) {
		if (e.code !== "ENOENT") throw e;
	}).return(to);
}

doxxo.document = function(source, opts) {
	// grab file contents
	return fs.readFileAsync(source.full).then(function(code) {
		// parse code into sections
		var sections = doxxo.parse(source.full, code.toString());
		if (!sections.length) return false;

		// make any leading directories
		return mkdirp(path.dirname(source.out))

		// process and write
		.then(function() {
			var content = doxxo.format(source, sections, opts);
			return fs.writeFileAsync(source.out, content).return(true);
		});
	}); 
}

doxxo.parse = function(source, code) {
	var ext = path.extname(source),
		sections = [];

	switch (ext) {
		case ".js":
			var comments = dox.parseComments(code, { raw: true });
			if (!comments.length) return sections;

			var lines = code.split("\n");

			sections = [{
				codeText: lines.slice(0, comments[0].line - 1).join('\n'),
				docsText: ''
			}];

			var comment, nextComment, codeEnd, code;

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

			break;

		case ".md":
		case ".markdown":
			sections = [{
				codeText: "",
				docsText: code
			}];

			break;

		default:
			throw new Error("ParseError: Unsupported file type '" + ext + "'");
	}

	return sections;
}

doxxo.format = function(source, sections, opts) {
	var firstSection, first, hasTitle, html,
		outdir = path.dirname(source.out);

	function destination(file) {
		if (_.isObject(file)) file = file.out;
		return path.relative(outdir, path.resolve(opts.output, file));
	}

	_.each(sections, function(section) {
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

	return opts.template(_.extend({
		title: hasTitle ? first.text : source.short,
		hasTitle: hasTitle,
		sections: sections,
		path: path,
		destination: destination
	}, opts));
}