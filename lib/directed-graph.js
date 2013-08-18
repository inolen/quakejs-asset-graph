function DirectedGraph() {
	this.vertices = [];
}

DirectedGraph.prototype.addVertex = function () {
	var v = new Vertex(this.vertices.length);
	this.vertices.push(v);
	return v;
};

DirectedGraph.prototype.addEdge = function (a, b) {
	var e = new Edge(a, b);

	a.out_edges.push(e);
	b.in_edges.push(e);

	return e;
};

function Vertex(id) {
	this.id = id;
	this.data = null;
	this.in_edges = [];
	this.out_edges = [];
}

function Edge(source, dest) {
	this.source = source;
	this.dest = dest;
}

module.exports = DirectedGraph;