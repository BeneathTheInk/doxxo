/**
 * # Doxxo
 *     
 *     Copyright (c) 2015 Beneath the Ink, Inc.
 *     MIT License
 *
 * A documentation generator inspired by [Docco](http://jashkenas.github.com/docco/). Doxxo parses block-level comments in JavaScript code to find documentation and parses them as markdown.
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

/**
 * ## Basic Usage
 *
 * While Doxxo was designed as a CLI tool, it can also be used as a Node.js module. To use Doxxo, pass it a list of source paths, some options and a function to call when it is finished. Doxxo also returns a valid Promise object (powered by [bluebird](https://www.npmjs.com/package/bluebird)) if that is more your style.
 *
 * ```javascript
 * var doxxo = require("doxxo");
 *
 * doxxo([ "lib/", "test/", "README.md" ], {
 *   layout: "linear",
 *   index: "README.md"
 * }, function(err) {
 *   if (err) console.error(err);
 * });
 * ```
 *
 * Doxxo also happens to be a constructor for a JavaScript class, giving you a bit more control over how the documentation process happens. Usage is also the same as above, with the exception that the operation is not asynchronous and returns a new Doxxo object instead. For reference, here is the code above rewritten with the class:
 *
 * ```javascript
 * var Doxxo = require("doxxo");
 *
 * var docs = new Doxxo([ "lib/", "test/", "README.md" ], {
 *   layout: "linear",
 *   index: "README.md"
 * });
 *
 * docs.document(function(err) {
 *   if (err) console.error(err);
 * });
 * ```
 *
 * #### Arguments
 *
 * - **paths** _string | array[string]_ - A path or array of paths for source files and directories.
 * - **opts** _object; optional_ - An object of options to dictate the documentation process. See below for valid options.
 * - **callback** _function; optional_ - A function that is called when the documentation process completes.
 */

var Doxxo =
module.exports = function(paths, opts, callback) {
	// the fast, easy way to run doxxo
	if (!(this instanceof Doxxo)) {
		return new Doxxo(paths, opts).document(callback);
	}

	// normalize paths argument
	paths = !_.isArray(paths) ? paths != null ? [ paths ] : [] : paths;

	// prep options
	this.options = Doxxo.configure(opts);

	// convert paths array into source objects
	this.sources = Doxxo.resolveSources(paths, this.options);

	// must have at least one source
	if (!this.sources.length) throw new Error("No valid sources provided.");
}

/**
 * ## Configuration
 *
 * Everything Doxxo does depends on the options provided, so a major portion of Doxxo's source code has been dedicated to configuration. Here are the available options:
 *
 * - **opts.output** _string; default: `'docs/'`_ - The output directory to write documentation files too.
 * - **opts.layout** _string; default: `'bti'`_ - The layout to use for generating documentation. This can be the name of a built-in layout or a file path to a layout directory.
 * - **opts.template** _string; default: `'doxxo.jst'`_ - The HTML template file to use for generating documentation. This should be a path that is relative to the layout directory.
 * - **opts.assets** _boolean; default: `true`_ - A flag that decides if the layout's asset files should be copied into the output folder.
 * - **opts.index** _string | null_ - A file that should be the index file. This file will named 'index.html' in the output.
 * - **opts.silent** _boolean; default: `true`_ - When set to `false`, Doxxo will log when things happen like the CLI tool does.
 * - **opts.recursive** _boolean; default: `false`_ - Whether or not to deeply look for documentable files in the source directories provided. This will maintain the deep folder structure to prevent filename collisions.
 * - **opts.marked** _object_ - An object of options to pass to [marked](https://www.npmjs.com/package/marked), our Markdown converter.
 */

// obtain built-in layouts directory and names
var cwd = process.cwd(),
	layout_dir = path.resolve(__dirname, "../layouts"),
	layouts = fs.readdirSync(layout_dir);

// base defaults
Doxxo.defaults = {
	output: "docs",
	layout: "bti",
	template: "doxxo.jst",
	assets: true,
	index: null,
	silent: true,
	recursive: false,
	marked: {
		smartypants: false,
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

/* `Doxxo.configure()` takes in user input for options, which should be an object or undefined, and normalizes it into something that can be used by the rest of the application. This is a key step because it prevents other functions from needing to test for certain values before using them. */
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

/* Layouts can be specified with either a built-in name or a directory path. Regardless of which is provided, `Doxxo.resolveLayout()` converts the user input into a directory path so every layout can be treated the same. */
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

/* `Doxxo.resolveTemplate()` extracts the template from the layout directory and converts it into a function using [Underscore templating](http://underscorejs.org/#template). In this way, Docco templates are semi-compatible with Doxxo since they use the same format. */
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

/**
 * ## Resolving Source Files
 *
 * Using Doxxo is simple to use because a lot of the magic happens when dealing with the file paths. A key aspect of Doxxo is taking the user provided relative paths and determining where their documentation counterparts should be saved. This requires using a blend of the current working directory and the output directory to generate the correct paths and can get especially tricky when dealing with deep file trees.
 *
 * `Doxxo.resolveSource()` will produce a unique array of source file objects from a list of file paths. Source objects serve as a representation of a specific file including details like the resulting output path. These source objects have several properties that are detailed below.
 *
 * #### Arguments
 *
 * - **paths** _array_ - An array of file paths.
 * - **opts** _object; optional_ - An object of options, usually whatever comes out of `Doxxo.configure()`.
 *   - **opts.recursive** _boolean_ - Whether or not deeply traverse all directories for source files.
 *   - **opts.output** _string_ - The documentation output directory.
 *   - **opts.index** _string | null_ - The file to use as the index. This file will out to `index.html` instead of a variety of its name.
 */

Doxxo.resolveSources = function(paths, opts) {
	opts = opts || {};

	// clean paths
	paths = Doxxo.cleanPaths(paths, opts.recursive);

	// obtain the common directory
	var common = commondir("/", _.values(paths)).substr(1);
	
	// return an array of source objects
	return _.map(paths, function(src, fp) {
		var isIndex, outpath;

		// check index, remove common directory, remove extension
		outpath = (isIndex = fp === opts.index) ? "index" :
			src.substr(0, src.length - path.extname(src).length).substr(common.length);

		// return a source object
		return {
			full: fp,
			out: path.join(opts.output, outpath + ".html"),
			name: src,
			isIndex: isIndex
		}
	});
}

/* `Doxxo.cleanPaths()` is a recursive function that takes an array of paths and reduces it into a unique set of files paths. It will also maintain a proper file "name" which is used to derive the resulting output directory. */
Doxxo.cleanPaths = function(paths, deep, strip, out) {
	var firstRun = strip == null;

	return paths.reduce(function(memo, src) {
		var fpath, stat;

		src = path.normalize(src);
		fpath = path.resolve(src);
		stat = fs.statSync(fpath);

		if (stat.isFile()) {
			if (firstRun) src = path.basename(src);

			else if (src.substr(0, strip.length) === strip) {
				src = src.substr(strip.length);
				while (src[0] === "/") src = src.substr(1);
			}

			memo[fpath] = src;
		}
		
		// only traverse into directory on first run or when deep is enabled
		else if (stat.isDirectory() && (firstRun || deep)) {
			Doxxo.cleanPaths(fs.readdirSync(fpath).map(function(f) {
				return path.join(src, f);
			}), deep, strip != null ? strip : src, memo);
		}

		return memo;
	}, out || {});
}

/**
 * ## Parsing Code
 *
 * Doxxo's primary job is to extract comments from source code and this done by the parsers. For JavaScript, [dox](https://www.npmjs.com/package/dox) does most of the heavy lifting. Using that output, we put together an array of section objects which seperates the block level comment content from the source code. The output from parsing is actually identical to Docco, so theoretically all of Docco's parsers would work with Doxxo too.
 *
 * `Doxxo.parse()` is really easy to use. Pass it the source code and the file's extension and an array of sections is returned. If the source type's parser can't be found, an empty array is returned. You can add you own custom parsers by attaching them directly to the `Doxxo.parsers` object.
 *
 * #### Arguments
 *
 * - **code** _string_ - A string of source code.
 * - **type** _string_ - The source code type. Generally the extension of the file it came from.
 */

// takes in source code and type and returns sections
Doxxo.parse = function(code, type) {
	var parser = Doxxo.parsers.byType(type);
	return _.isFunction(parser) ? parser(code) : [];
}

// parses, by type
Doxxo.parsers = {
	js: function(code) {
		var comments, lines, sections, firstSection, comment, nextComment, codeEnd, code;

		sections = [];
		comments = dox.parseComments(code, { raw: true });
		if (!comments.length) return sections;

		lines = code.split("\n");
		firstSection = lines.slice(0, comments[0].line - 1).join('\n');

		// handle the first section
		if (firstSection.trim() !== "") sections.push({
			codeText: firstSection,
			docsText: ''
		});

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

/**
 * ## Documenting
 *
 * The real meat of Doxxo happens behind several Doxxo instance methods. These methods are designed to take the source files, convert them into HTML files and save everything to the output folder.
 */

/**
 * ### Doxxo#document()
 *
 * This is main method of a Doxxo instance and is responsible for glueing together all the documentation steps. This method parses the sources, generates the output folder, copies layout assets and then generates the documentation files. A Promise object is returned that is resolved when the process completes.
 *
 * #### Arguments
 *
 * - **callback** _function; optional_ - A function to call when the process completes.
 */
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
			return Promise.each(
				sources,
				self.write.bind(this),
				{ concurrency: 1 }
			);
		});
	})

	// for the old-school asyncs
	.nodeify(callback);
}

/**
 * ### Doxxo#parseSources()
 *
 * `Doxxo.resolveSources()` is very unbiased when comes to the types of files it accepts. In order to be slightly more future proof, the step of actually verifying and parsing a source comes right before we start generating the documentation. This method will filter out any unsupported files based on what parsers are available and then parse each source accordingly. A Promise object is returned that is resolved when all sources have been removed or parsed.
 */
Doxxo.prototype.parseSources = function() {
	// parse sources and filter out the empties
	return Promise.resolve(this.sources).bind(this).filter(function(src) {
		// check the type is supported
		if (!Doxxo.parsers.byType(path.extname(src.full))) {
			this.options.log("Ignoring unsupported file: '%s'", path.relative(cwd, src.full));
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

/**
 * ### Doxxo#copyLayoutAssets()
 *
 * Layout directories can contain a `public/` folder with additional files needed for the documentation, like styling. This method checks for this directory and copies it into the output folder.
 */
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

/**
 * ### Doxxo#format()
 *
 * This method has the responsibility of producing the HTML documentation from a source object. This mostly means putting together template data and methods, running the template function, returning the resulting HTML.
 *
 * #### Arguments
 *
 * - **source** _object_ - The source object to turn into HTML. This should have a `.sections` property with parsed data on it.
 */
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
		doxxo: this
	});
}

/**
 * ### Doxxo#write()
 *
 * Takes in a parsed source object, produces HTML with `.format()`, and writes the HTML to the correct output path.
 *
 * #### Arguments
 *
 * - **src** _object_ - The source object to format and save.
 */
Doxxo.prototype.write = function(src) {
	// make any leading directories
	return mkdirp(path.dirname(src.out)).bind(this)

	// format and write to the filesystem
	.then(function() {
		return fs.writeFileAsync(src.out, this.format(src));
	})

	// log when finished
	.then(function() {
		this.options.log("%s -> %s", path.relative(cwd, src.full), path.relative(cwd, src.out));
	});
}
