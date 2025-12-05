// D3 визуализация + интерфейс
const svg = d3.select("#svgCanvas");
const width = +svg.node().getBoundingClientRect().width;
const height = +svg.node().getBoundingClientRect().height;

let simulation;
let linkGroup, nodeGroup, labelGroup;
let graph = {nodes: [], edges: []};

const status = document.getElementById("status");
const repoInput = document.getElementById("repoInput");
document.getElementById("analyzeBtn").addEventListener("click", analyzeRepo);

function setStatus(txt) {
  status.textContent = txt;
}

// initial defs for glow
const defs = svg.append("defs");
const glow = defs.append("filter")
  .attr("id","glow")
  .append("feGaussianBlur")
  .attr("stdDeviation", "6")
;
defs.append("linearGradient").attr("id","gradNode")
  .selectAll("stop")
  .data([{offset:"0%", color:"#7b61ff"},{offset:"100%",color:"#00f0ff"}])
  .enter().append("stop")
  .attr("offset", d=>d.offset)
  .attr("stop-color", d=>d.color);

function analyzeRepo(){
  const url = repoInput.value.trim();
  if(!url){
    setStatus("Введите ссылку на GitHub.");
    return;
  }
  setStatus("Клонирование и анализ репозитория... (подождите)");
  fetch("/analyze", {
    method:"POST",
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({repo_url: url})
  }).then(r=>r.json()).then(data=>{
    if(!data.ok){
      setStatus("Ошибка: " + (data.detail || "unknown"));
      return;
    }
    graph = normalizeGraph(data.data);
    setStatus(`Узлов: ${graph.nodes.length}, рёбер: ${graph.edges.length}`);
    renderGraph(graph);
  }).catch(err=>{
    console.error(err);
    setStatus("Ошибка запроса: " + err.message);
  });
}

function normalizeGraph(data){
  // data.nodes: {id,fqname,label,type,file,lineno}
  // data.edges: {source,target}
  // convert to arrays suitable for d3
  const nodes = data.nodes.map(n => ({
    id: n.id,
    label: n.label,
    fqname: n.fqname,
    type: n.type
  }));
  const edges = data.edges.map(e => ({
    source: e.source,
    target: e.target
  }));
  // optionally prune isolated nodes? keep all
  return {nodes, edges};
}

function renderGraph(g){
  svg.selectAll("*").remove();

  // re-add defs
  const defs = svg.append("defs");
  defs.append("filter").attr("id","glow")
    .append("feGaussianBlur").attr("stdDeviation","6");
  defs.append("linearGradient").attr("id","gradNode")
    .selectAll("stop")
    .data([{offset:"0%", color:"#7b61ff"},{offset:"100%",color:"#00f0ff"}])
    .enter().append("stop")
    .attr("offset", d=>d.offset).attr("stop-color", d=>d.color);

  const linkG = svg.append("g").attr("class","links");
  const nodeG = svg.append("g").attr("class","nodes");
  const labelG = svg.append("g").attr("class","labels");

  // scales
  const sizeScale = d3.scaleOrdinal()
    .domain(["class","function","method"])
    .range([16,12,10]);

  // create simulation
  simulation = d3.forceSimulation(g.nodes)
    .force("link", d3.forceLink(g.edges).id(d=>d.id).distance(80).strength(0.7))
    .force("charge", d3.forceManyBody().strength(-140))
    .force("center", d3.forceCenter(width/2, height/2))
    .force("collision", d3.forceCollide().radius(d => sizeScale(d.type) + 8))
    .on("tick", ticked);

  // links
  const link = linkG.selectAll("line")
    .data(g.edges)
    .enter().append("line")
    .attr("stroke-width", 1.2)
    .attr("stroke-opacity", 0.35)
    .attr("class","edge")
    .on("mouseover", (event,d) => {
      highlightEdge(d, true);
    })
    .on("mouseout", (event,d) => {
      highlightEdge(d, false);
    });

  // directional arrow
  defs.append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 18)
    .attr("refY", 0)
    .attr("markerWidth", 8)
    .attr("markerHeight", 8)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#9fb3ff")
    .attr("opacity", 0.7);

  link.attr("marker-end","url(#arrow)");

  // nodes
  const node = nodeG.selectAll("g")
    .data(g.nodes)
    .enter().append("g")
    .attr("class","node")
    .call(drag(simulation));

  node.append("circle")
    .attr("r", d => sizeScale(d.type) + 6)
    .attr("fill", d => "url(#gradNode)")
    .attr("stroke", "rgba(255,255,255,0.08)")
    .attr("stroke-width", 1)
    .style("filter", "url(#glow)")
    .on("mouseover", (event, d) => {
      highlightNode(d, true);
      showTooltip(event, d);
    })
    .on("mouseout", (event, d) => {
      highlightNode(d, false);
      hideTooltip();
    });

  node.append("text")
    .text(d => d.label)
    .attr("x", 0)
    .attr("y", d => - (sizeScale(d.type) + 10))
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .attr("fill", "#eaf2ff")
    .attr("pointer-events", "none");

  // tooltip
  const tooltip = d3.select("body").append("div").attr("class","tooltip").style("display","none");

  function showTooltip(event, d){
    tooltip.style("display","block")
           .html(`<strong>${d.fqname}</strong><br/>type: ${d.type}`)
           .style("left", (event.pageX + 12) + "px")
           .style("top", (event.pageY + 12) + "px");
  }
  function hideTooltip(){
    tooltip.style("display","none");
  }

  // neighbor map for highlighting
  const neighborMap = buildNeighborMap(g);

  function highlightNode(d, on){
    if(on){
      // highlight d and its neighbors
      node.selectAll("circle").style("opacity", n => (n.id === d.id || neighborMap[d.id].has(n.id)) ? 1 : 0.12);
      node.selectAll("text").style("opacity", n => (n.id === d.id || neighborMap[d.id].has(n.id)) ? 1 : 0.12);
      link.style("opacity", l => (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.06)
          .style("stroke", l => (l.source.id === d.id || l.target.id === d.id) ? "#a8d1ff" : "#9fb3ff");
    } else {
      node.selectAll("circle").style("opacity", 1);
      node.selectAll("text").style("opacity", 1);
      link.style("opacity", 0.35).style("stroke", "#9fb3ff");
    }
  }

  function highlightEdge(edge, on){
    if(on){
      const srcId = typeof edge.source === "object" ? edge.source.id : edge.source;
      const tgtId = typeof edge.target === "object" ? edge.target.id : edge.target;
      node.selectAll("circle").style("opacity", n => (n.id === srcId || n.id === tgtId) ? 1 : 0.12);
      node.selectAll("text").style("opacity", n => (n.id === srcId || n.id === tgtId) ? 1 : 0.12);
      link.style("opacity", l => (l === edge) ? 1 : 0.06);
    } else {
      node.selectAll("circle").style("opacity", 1);
      node.selectAll("text").style("opacity", 1);
      link.style("opacity", 0.35);
    }
  }

  function ticked(){
    link
      .attr("x1", d=>d.source.x)
      .attr("y1", d=>d.source.y)
      .attr("x2", d=>d.target.x)
      .attr("y2", d=>d.target.y);
    node.attr("transform", d => `translate(${d.x},${d.y})`);
  }
}

function buildNeighborMap(g){
  const map = {};
  g.nodes.forEach(n => map[n.id] = new Set());

  g.edges.forEach(e => {
    // если D3 уже заменил строки на объекты — берем их id
    const src = typeof e.source === "object" ? e.source.id : e.source;
    const tgt = typeof e.target === "object" ? e.target.id : e.target;

    if (map[src]) map[src].add(tgt);
    if (map[tgt]) map[tgt].add(src);
  });

  return map;
}


function drag(sim){
  function dragstarted(event){
    if(!event.active) sim.alphaTarget(0.3).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }
  function dragged(event){
    event.subject.fx = event.x;
    event.subject.fy = event.y;
  }
  function dragended(event){
    if(!event.active) sim.alphaTarget(0);
    event.subject.fx = null;
    event.subject.fy = null;
  }
  return d3.drag()
    .on("start", dragstarted)
    .on("drag", dragged)
    .on("end", dragended);
}

// автозаполнение примера
repoInput.value = "https://github.com/psf/requests";
