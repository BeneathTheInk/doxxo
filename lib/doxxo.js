var _ = require('underscore'),
	fs = require('fs-extra'),
	path = require('path'),
	marked = require('marked'),
	commander = require('commander'),
	highlightjs = require('highlight.js'),
	dox = require("dox");

var defaults = {
	layout:     'parallel',
	output:     'docs',
	template:   null,
	css:        null,
	marked:     null
};

var Doxxo = module.exports = {
	version: require('../package.json').version,
	run: run,
	configure: configure,
	document: document,
	parse: parse,
	format: format,
	write: write
};

function document(options, callback) {
	var config = Doxxo.configure(options || {});

	fs.mkdirs(config.output, function() {
		if (callback == null) {
			callback = function(err) { if (err) throw err; }
		}

		var files = config.sources.slice();
		nextFile();
		
		function copyAsset(file, callback) {
			if (!fs.existsSync(file)) return callback();
			fs.copy(file, path.join(config.output, path.basename(file)), callback);
		}
		
		function complete() {
			copyAsset(config.css, function(error) {
				if (error) return callback(error);
				if (fs.existsSync(config.public)) return copyAsset(config.public, callback);
				callback();
			});
		}

		function nextFile() {
			var source = files.shift();

			fs.readFile(source, function(error, buffer) {
				if (error) return callback(error);

				var code = buffer.toString();
				var sections = Doxxo.parse(source, code, config);
				Doxxo.format(source, sections, config);
				Doxxo.write(source, sections, config);
				
				if (files.length) nextFile();
				else complete();
			});
		}
	});
}

function parse(source, code, config) {
	config = config || {};

	var comments = dox.parseComments(code, { raw: true });
	if (!comments.length) return [];

	var lines = code.split("\n");

	var sections = [{
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

	return sections;
}

function format(source, sections, config) {
	var markedOptions = config.marked || {
		smartypants: true
	};

	_.defaults(markedOptions, {
		highlight: function(code, lang) {
			if (highlightjs.getLanguage(lang)) {
				return highlightjs.highlight(lang, code).value;
			} else {
				return code;
			}
		}
	});

	_.each(sections, function(section) {
		var code = highlightjs.highlight("javascript", section.codeText).value;
		code = code.replace(/\s+$/, '');
		section.codeHtml = "<div class='highlight'><pre>" + code + "</pre></div>";
		section.docsHtml = marked(section.docsText, markedOptions);
	});
}

function write(source, sections, config) {
	var firstSection, first, hasTitle, html;

	function destination(file) {
		return path.join(config.output, path.basename(file, path.extname(file)) + '.html');
	}

	firstSection = _.find(sections, function(section) {
		return section.docsText.length > 0
	});

	if (firstSection) first = marked.lexer(firstSection.docsText)[0];
	hasTitle = first && first.type === 'heading' && first.depth === 1;

	html = config.template({
		sources: config.sources,
		css: path.basename(config.css),
		title: hasTitle ? first.text : path.basename(source),
		hasTitle: hasTitle,
		sections: sections,
		path: path,
		destination: destination
	});

	console.log("doxxo: %s -> %s", source, destination(source));
	fs.writeFileSync(destination(source), html);
}

function configure(options) {
	var config = _.extend({}, defaults, _.pick(options, _.keys(defaults)));

	if (options.template) {
		if (!options.css) console.warn("docco: no stylesheet file specified");
		config.layout = null;
	} else {
		var dir = config.layout = path.resolve(__dirname, '../templates', config.layout);
		if (fs.existsSync(path.join(dir, 'public'))) config.public = path.join(dir, 'public');
		config.template = path.join(dir, 'docco.jst');
		config.css = options.css || path.join(dir, 'docco.css');
	}

	config.template = _.template(fs.readFileSync(config.template).toString());

	if (options.marked) {
		config.marked = JSON.parse(fs.readFileSync(options.marked));
	}

	config.sources = options.args.sort();

	return config;
}

function run(args) {
	args = args || process.argv;
	c = defaults

	commander.version(Doxxo.version)
		.usage('[options] files')
		.option('-l, --layout [name]',    'choose a layout (parallel, linear or classic)', defaults.layout)
		.option('-o, --output [path]',    'output to a given folder', defaults.output)
		.option('-c, --css [file]',       'use a custom css file', defaults.css)
		.option('-t, --template [file]',  'use a custom .jst template', defaults.template)
		.option('-m, --marked [file]',    'use custom marked options', defaults.marked)
		.parse(args)
		.name = "doxxo"

	if (commander.args.length) Doxxo.document(commander);
	else console.log(commander.helpInformation());
}