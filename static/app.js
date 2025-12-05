// app.js: fetch graph from /analyze and render D3 force graph (SVG)
// No <canvas> used. Interactivity: hover a node/edge highlights neighbours and dims others.

const repoInput = document.getElementById('repo');
const loadBtn = document.getElementById('loadBtn');
const info = document.getElementById('info');
const canvas = document.getElementById('canvas');

loadBtn.addEventListener('click', () => {
  const repo = repoInput.value.trim();
  if (!repo) {
    info.textContent = "Введите ссылку на публичный GitHub репозиторий.";
    return;
  }
  info.textContent = "Анализ... это может занять пару секунд.";
  fetchGraph(repo);
});

async function fetchGraph(repo) {
  try {
    const url = '/analyze';
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({repo_url: repo})
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({detail: 'ошибка'}));
      info.textContent = 'Ошибка сервера: ' + (err.detail || JSON.stringify(err));
      return;
    }
    const data = await res.json();
    info.textContent = `Найдено узлов: ${data.nodes.length}, рёбер: ${data.links.length}`;
    renderGraph(data);
  } catch (e) {
    info.textContent = 'Ошибка: ' + String(e);
  }
}

function renderGraph(graph) {
  // clear
  canvas.innerHTML = '';
  const width = canvas.clientWidth || 1200;
  const height = Math.max(600, canvas.clientHeight || 800);

  const svg = d3.select('#canvas').append('svg')
    .attr('width', '100%')
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('overflow', 'visible');

  // defs for gradients
  const defs = svg.append('defs');
  const grad = defs.append('linearGradient').attr('id','g1').attr('x1','0%').attr('x2','100%');
  grad.append('stop').attr('offset','0%').attr('stop-color','#7c5cff');
  grad.append('stop').attr('offset','100%').attr('stop-color','#00e0b8');

  // create simulation
  const nodes = graph.nodes.map(d => Object.assign({}, d));
  const links = graph.links.map(d => Object.assign({}, d));

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).distance(80).strength(0.6).id((d,i)=>i))
    .force('charge', d3.forceManyBody().strength(-100))
    .force('center', d3.forceCenter(width/2, height/2))
    .force('collision', d3.forceCollide().radius(24));

  // link lines
  const link = svg.append('g')
    .attr('class','links')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke-opacity', 0.6)
    .attr('stroke-width', 1.2)
    .attr('stroke', '#1e293b');

  // nodes group
  const node = svg.append('g')
    .attr('class','nodes')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .call(drag(simulation));

  // circle + glow
  node.append('circle')
    .attr('r', 10)
    .attr('fill', (d,i) => 'url(#g1)')
    .attr('stroke', '#0b1220')
    .attr('stroke-width', 1.5)
    .attr('filter','');

  // labels
  node.append('text')
    .text(d => d.label)
    .attr('x', 14)
    .attr('y', 4)
    .attr('font-size', 12)
    .attr('fill', '#dbe9ff')
    .style('pointer-events','none');

  // build adjacency for hover highlighting
  const adjacency = {};
  links.forEach(l => {
    adjacency[`${l.source.index}-${l.target.index}`] = true;
    adjacency[`${l.target.index}-${l.source.index}`] = true;
  });

  function isConnected(a, b) {
    return adjacency[`${a.index}-${b.index}`] || a.index === b.index;
  }

  // hover events
  node.on('mouseover', function(event, d) {
    // highlight node and its neighbours
    node.selectAll('circle').style('opacity', o => isConnected(d, o) ? 1 : 0.12);
    node.selectAll('text').style('opacity', o => isConnected(d, o) ? 1 : 0.12);
    link.style('opacity', l => (l.source.index === d.index || l.target.index === d.index) ? 1 : 0.06)
        .attr('stroke-width', l => (l.source.index === d.index || l.target.index === d.index) ? 2.4 : 1.0)
        .attr('stroke', l => (l.source.index === d.index || l.target.index === d.index) ? '#fff' : '#324154');
  });

  node.on('mouseout', function() {
    node.selectAll('circle').style('opacity', 1);
    node.selectAll('text').style('opacity', 1);
    link.style('opacity', 0.6).attr('stroke-width',1.2).attr('stroke','#1e293b');
  });

  link.on('mouseover', function(event, l) {
    node.selectAll('circle').style('opacity', o => (o.index === l.source.index || o.index === l.target.index) ? 1 : 0.12);
    node.selectAll('text').style('opacity', o => (o.index === l.source.index || o.index === l.target.index) ? 1 : 0.12);
    link.style('opacity', ll => (ll === l) ? 1 : 0.06)
        .attr('stroke-width', ll => (ll === l) ? 2.8 : 1.0)
        .attr('stroke', ll => (ll === l) ? '#fff' : '#324154');
  });

  link.on('mouseout', function() {
    node.selectAll('circle').style('opacity', 1);
    node.selectAll('text').style('opacity', 1);
    link.style('opacity', 0.6).attr('stroke-width',1.2).attr('stroke','#1e293b');
  });

  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // simple zoom/pan
  svg.call(d3.zoom().on("zoom", (event) => {
    svg.selectAll('g').attr('transform', event.transform);
  }));

  // drag helpers
  function drag(simulation){
    function dragstarted(event, d){
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(event, d){
      d.fx = event.x;
      d.fy = event.y;
    }
    function dragended(event, d){
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
    return d3.drag()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended);
  }
}
