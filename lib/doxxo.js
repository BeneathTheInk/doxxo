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

var doxxo =
module.exports = function(sources, opts, callback) {
	// normalize sources argument
	sources = !_.isArray(sources) ? sources != null ? [ sources ] : [] : sources;
	if (!sources.length) throw new Error("No filenames provided.");

	// prep options and fill in the blanks
	opts = _.defaults(opts ? _.clone(opts) : {}, doxxo.defaults);
	opts.output = path.resolve(opts.output);
	opts.layout = doxxo.resolveLayout(opts.layout);
	opts.template = doxxo.resolveTemplate(opts.layout, opts.template);

	// resolve sources and determine output paths
	opts.sources = sources = doxxo.cleanSources(doxxo.resolveSources(sources), opts.output, opts.index);

	// create the output directory
	return mkdirp(opts.output)

	// copy layout assets
	.then(function() {
		return doxxo.copyLayoutAssets(opts.layout, opts.output);
	})

	// process each source file
	.then(function() {
		return Promise.each(sources, function(src) {
			return doxxo.document(src, opts);
		}, { concurrency: 1 });
	})

	// for the old-school asyncs
	.nodeify(callback);
}

doxxo.defaults = {
	output: "docs",
	layout: "bti",
	template: "doxxo.jst",
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

doxxo.resolveSources = function(sources, out, strip) {
	return sources.reduce(function(memo, src) {
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
			doxxo.resolveSources(fs.readdirSync(fpath).map(function(f) {
				return path.join(src, f);
			}), memo, strip != null ? strip : src);
		}

		return memo;
	}, out || {});
}

doxxo.cleanSources = function(sources, dir, index) {
	index = index != null ? path.resolve(index) : "";
	var common = commondir("/", _.values(sources)).substr(1);
	
	return _.map(sources, function(src, fp) {
		var isIndex, name;

		name = (isIndex = fp === index) ? "index" :
			src.substr(0, src.length - path.extname(src).length).substr(common.length);

		return {
			full: fp,
			out: path.join(dir, name + ".html"),
			short: src,
			isIndex: isIndex
		}
	});
}

var layout_dir = path.resolve(__dirname, "../layouts"),
	layouts = fs.readdirSync(layout_dir);

doxxo.resolveLayout = function(layout) {
	if (_.contains(layouts, layout)) return path.join(layout_dir, layout);

	var fpath = path.resolve(layout);

	try {
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

doxxo.copyLayoutAssets = function(layout, output) {
	var assets = path.join(layout, "public");

	try {
		if (!fs.statSync(assets).isDirectory()) return Promise.resolve();
	} catch(e) {
		return Promise.resolve();
	}

	return cpr(assets, path.join(output, "public"), {
		deleteFirst: false,
		overwrite: true,
		confirm: false
	});
}

doxxo.document = function(source, opts) {
	var cwd = process.cwd();

	// grab file contents
	return fs.readFileAsync(source.full, "utf-8")

	// make any leading directories
	.tap(function() { return mkdirp(path.dirname(source.out)); })

	// process and write
	.then(function(code) {
		var sections, content;

		sections = doxxo.parse(source.full, code);
		if (!sections.length) return;

		content = doxxo.format(source, sections, opts);
		if (!opts.silent) console.log("doxxo: %s -> %s", path.relative(cwd, source.full), path.relative(cwd, source.out));
		return fs.writeFileAsync(source.out, content);
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
			console.warn("Unsupported file type: '%s'", ext);
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