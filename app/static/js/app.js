// D3 визуализация + интерфейс
const svg = d3.select("#svgCanvas");
const width = +svg.node().getBoundingClientRect().width;
const height = +svg.node().getBoundingClientRect().height;

let simulation;
let graph = {nodes: [], edges: []};

const status = document.getElementById("status");
const repoInput = document.getElementById("repoInput");
const analyzeBtn = document.getElementById("analyzeBtn");
analyzeBtn.addEventListener("click", analyzeRepo);

// ====== спиннер (крутилка) ======
const spinnerStyle = document.createElement("style");
spinnerStyle.textContent = `
.spinner{
  margin-left:8px;
  width:16px;height:16px;
  border-radius:50%;
  border:2px solid rgba(255,255,255,0.2);
  border-top-color:#7b61ff;
  animation:spin 0.7s linear infinite;
  display:inline-block;
}
@keyframes spin{
  to{ transform:rotate(360deg); }
}`;
document.head.appendChild(spinnerStyle);

const spinnerEl = document.createElement("span");
spinnerEl.className = "spinner";
spinnerEl.style.display = "none";
status.after(spinnerEl);

function setLoading(isLoading) {
  if (isLoading) {
    analyzeBtn.disabled = true;
    spinnerEl.style.display = "inline-block";
  } else {
    analyzeBtn.disabled = false;
    spinnerEl.style.display = "none";
  }
}

function setStatus(txt) {
  status.textContent = txt;
}

// initial defs for glow (используем небольшое свечение)
const defs = svg.append("defs");
defs.append("filter")
  .attr("id","glow")
  .append("feGaussianBlur")
  .attr("stdDeviation", "2");

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
  setLoading(true);
  setStatus("Клонирование и анализ репозитория...");

  fetch("/analyze", {
    method:"POST",
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({repo_url: url})
  })
    .then(r=>r.json())
    .then(data=>{
      if(!data.ok){
        setStatus("Ошибка: " + (data.detail || "unknown"));
        return;
      }
      graph = normalizeGraph(data.data);
      setStatus(`Узлов: ${graph.nodes.length}, рёбер: ${graph.edges.length}`);
      renderGraph(graph);
    })
    .catch(err=>{
      console.error(err);
      setStatus("Ошибка запроса: " + err.message);
    })
    .finally(()=>{
      setLoading(false);
    });
}

function normalizeGraph(data){
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
  return {nodes, edges};
}

function renderGraph(g){
  svg.selectAll("*").remove();

  // ===== defs (glow, gradient, arrow) =====
  const defs = svg.append("defs");
  defs.append("filter").attr("id","glow")
    .append("feGaussianBlur").attr("stdDeviation","2");

  defs.append("linearGradient").attr("id","gradNode")
    .selectAll("stop")
    .data([{offset:"0%", color:"#7b61ff"},{offset:"100%",color:"#00f0ff"}])
    .enter().append("stop")
    .attr("offset", d=>d.offset)
    .attr("stop-color", d=>d.color);

  defs.append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 14)
    .attr("refY", 0)
    .attr("markerWidth", 7)
    .attr("markerHeight", 7)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#9fb3ff")
    .attr("opacity", 0.7);

  // ===== слой, который будем зумить и таскать =====
  const zoomLayer = svg.append("g").attr("class", "zoom-layer");

  const linkG = zoomLayer.append("g").attr("class","links");
  const nodeG = zoomLayer.append("g").attr("class","nodes");

  // ======== ЗУМ + ПАНОРАМА ========
  // Alt + колесо -> зум, ЛКМ по пустому -> панорамирование
  const zoom = d3.zoom()
    .scaleExtent([0.2, 3]) // минимальный / максимальный масштаб
    .filter(event => {
      // Зум: только Alt + колесо мыши
      if (event.type === "wheel") {
        return event.altKey;
      }
      // Остальное — как дефолтный фильтр d3.zoom:
      // ЛКМ без модификаторов -> панорамирование
      return (!event.ctrlKey && !event.button && !event.altKey && !event.metaKey && !event.shiftKey)
             || event.type === "touchstart";
    })
    .on("zoom", (event) => {
      zoomLayer.attr("transform", event.transform);
    });

  svg
    .call(zoom)
    .on("dblclick.zoom", null); // убираем зум по двойному клику (чтобы не мешал)

  // ======== СИМУЛЯЦИЯ ========
    // компактные точки
  const sizeScale = d3.scaleOrdinal()
    .domain(["class","function","method"])
    .range([8, 6, 5]); // немного разные, но все маленькие аккуратные

  const colorScale = d3.scaleOrdinal()
    .domain(["class","function","method"])
    .range([
      "#a48bff", // class
      "#00d4ff", // function
      "#ff9f6b"  // method
    ]);


  simulation = d3.forceSimulation(g.nodes)
    .force("link", d3.forceLink(g.edges).id(d=>d.id).distance(80).strength(0.7))
    .force("charge", d3.forceManyBody().strength(-140))
    .force("center", d3.forceCenter(width/2, height/2))
    .force("collision", d3.forceCollide().radius(d => sizeScale(d.type) + 5))
    .on("tick", ticked);

  // ======== РЁБРА ========
  const link = linkG.selectAll("line")
    .data(g.edges)
    .enter().append("line")
    .attr("stroke-width", 1.1)
    .attr("stroke-opacity", 0.35)
    .attr("stroke", "#9fb3ff")
    .attr("class","edge")
    .attr("marker-end","url(#arrow)")
    .on("mouseover", (event,d) => {
      highlightEdge(d, true);
    })
    .on("mouseout", (event,d) => {
      highlightEdge(d, false);
    });

  // ======== УЗЛЫ ========
  const node = nodeG.selectAll("g")
    .data(g.nodes)
    .enter().append("g")
    .attr("class","node")
    .call(drag(simulation));  // перетаскивание отдельных узлов (как было)

    node.append("circle")
    .attr("r", d => sizeScale(d.type) || 6)          // на всякий случай дефолт
    .attr("fill", d => colorScale(d.type) || "#ccc") // цвет по типу
    .attr("stroke", "rgba(255,255,255,0.6)")
    .attr("stroke-width", 0.8)
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
    .attr("y", -(sizeScale.range()[0] + 10))
    .attr("text-anchor", "middle")
    .attr("font-size", 10)
    .attr("fill", "#eaf2ff")
    .attr("pointer-events", "none");

  // ===== tooltip =====
  const tooltip = d3.select("body")
    .append("div")
    .attr("class","tooltip")
    .style("display","none");

  function showTooltip(event, d){
    tooltip.style("display","block")
           .html(`<strong>${d.fqname}</strong><br/>type: ${d.type}`)
           .style("left", (event.pageX + 12) + "px")
           .style("top", (event.pageY + 12) + "px");
  }
  function hideTooltip(){
    tooltip.style("display","none");
  }

  const neighborMap = buildNeighborMap(g);

  function highlightNode(d, on){
    if(on){
      node.selectAll("circle").style("opacity", n => (n.id === d.id || neighborMap[d.id].has(n.id)) ? 1 : 0.12);
      node.selectAll("text").style("opacity", n => (n.id === d.id || neighborMap[d.id].has(n.id)) ? 1 : 0.12);
      link
        .style("opacity", l => {
          const srcId = typeof l.source === "object" ? l.source.id : l.source;
          const tgtId = typeof l.target === "object" ? l.target.id : l.target;
          return (srcId === d.id || tgtId === d.id) ? 1 : 0.06;
        })
        .style("stroke", l => {
          const srcId = typeof l.source === "object" ? l.source.id : l.source;
          const tgtId = typeof l.target === "object" ? l.target.id : l.target;
          return (srcId === d.id || tgtId === d.id) ? "#a8d1ff" : "#9fb3ff";
        });
    } else {
      node.selectAll("circle").style("opacity", 1);
      node.selectAll("text").style("opacity", 1);
      link.style("opacity", 0.35).style("stroke", "#9fb3ff");
    }
  }

  function highlightEdge(edge, on){
    const srcId = typeof edge.source === "object" ? edge.source.id : edge.source;
    const tgtId = typeof edge.target === "object" ? edge.target.id : edge.target;
    if(on){
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
