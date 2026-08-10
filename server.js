const http=require("http"),fs=require("fs"),path=require("path"),WebSocket=require("ws");
const PORT=process.env.PORT||8080,W=1100,H=600,GOAL_H=210,PLAYER_R=18,BALL_R=13,MAX_PLAYERS=16;
const players=new Map();let nextId=1,score={blue:0,red:0},round=1,resetAt=0;
const ball={x:W/2,y:H/2,vx:0,vy:0};

function counts(){let blue=0,red=0;for(const p of players.values())p.team==="blue"?blue++:red++;return{blue,red}}
function autoTeams(){let a=[...players.values()].sort(()=>Math.random()-.5);a.forEach((p,i)=>p.team=i%2?"red":"blue");}
function spawn(p){p.x=p.team==="blue"?180:W-180;p.y=130+Math.random()*(H-260);p.vx=p.vy=0}
function resetBall(){ball.x=W/2;ball.y=H/2;ball.vx=ball.vy=0;for(const p of players.values())spawn(p)}
function state(){return{type:"state",W,H,score,round,resetAt,ball:{...ball},players:[...players.values()].map(p=>({id:p.id,name:p.name,team:p.team,x:p.x,y:p.y,vx:p.vx,vy:p.vy}))}}
function broadcast(){const s=JSON.stringify(state());for(const p of players.values())if(p.ws.readyState===WebSocket.OPEN)p.ws.send(s)}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function physics(dt){
 if(resetAt){if(Date.now()>=resetAt){resetAt=0;round++;autoTeams();resetBall();broadcast()}return}
 for(const p of players.values()){
  let ax=0,ay=0;if(p.keys.up)ay--;if(p.keys.down)ay++;if(p.keys.left)ax--;if(p.keys.right)ax++;
  const accel=900,max=260;if(ax||ay){const l=Math.hypot(ax,ay);p.vx+=ax/l*accel*dt;p.vy+=ay/l*accel*dt}else{p.vx*=Math.pow(.0005,dt);p.vy*=Math.pow(.0005,dt)}
  const sp=Math.hypot(p.vx,p.vy);if(sp>max){p.vx=p.vx/sp*max;p.vy=p.vy/sp*max}
  p.x+=p.vx*dt;p.y+=p.vy*dt;p.y=clamp(p.y,PLAYER_R,H-PLAYER_R);
  const inGoal=Math.abs(p.y-H/2)<GOAL_H/2;p.x=clamp(p.x,inGoal?-10:PLAYER_R,inGoal?W+10:W-PLAYER_R)
 }
 const a=[...players.values()];
 for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++){const x=a[i],y=a[j],dx=y.x-x.x,dy=y.y-x.y,d=Math.hypot(dx,dy)||.001,min=PLAYER_R*2;if(d<min){const q=(min-d)/2,nx=dx/d,ny=dy/d;x.x-=nx*q;x.y-=ny*q;y.x+=nx*q;y.y+=ny*q}}
 ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;ball.vx*=Math.pow(.16,dt);ball.vy*=Math.pow(.16,dt);
 if(ball.y<BALL_R){ball.y=BALL_R;ball.vy=Math.abs(ball.vy)*.75}if(ball.y>H-BALL_R){ball.y=H-BALL_R;ball.vy=-Math.abs(ball.vy)*.75}
 const inGoal=Math.abs(ball.y-H/2)<GOAL_H/2;
 if(!inGoal&&ball.x<BALL_R){ball.x=BALL_R;ball.vx=Math.abs(ball.vx)*.75}
 if(!inGoal&&ball.x>W-BALL_R){ball.x=W-BALL_R;ball.vx=-Math.abs(ball.vx)*.75}
 for(const p of a){const dx=ball.x-p.x,dy=ball.y-p.y,d=Math.hypot(dx,dy)||.001,min=PLAYER_R+BALL_R;if(d<min){const nx=dx/d,ny=dy/d,q=min-d;ball.x+=nx*q;ball.y+=ny*q;const k=150+Math.min(180,Math.hypot(p.vx,p.vy)*.55);ball.vx+=nx*k;ball.vy+=ny*k}}
 if(ball.x<-BALL_R&&inGoal){score.red++;resetAt=Date.now()+1800}
 if(ball.x>W+BALL_R&&inGoal){score.blue++;resetAt=Date.now()+1800}
}
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split("?")[0]);if(u==="/")u="/index.html";const base=path.join(__dirname,"public"),file=path.join(base,u);if(!file.startsWith(base)){res.writeHead(403);return res.end()}fs.readFile(file,(e,d)=>{if(e){res.writeHead(404);return res.end("Not found")}res.writeHead(200,{"Content-Type":path.extname(file)===".html"?"text/html; charset=utf-8":"text/javascript; charset=utf-8"});res.end(d)})});
const wss=new WebSocket.Server({server});
wss.on("connection",ws=>{if(players.size>=MAX_PLAYERS){ws.send(JSON.stringify({type:"error",message:"Server đầy"}));return ws.close()}const id=String(nextId++),p={id,name:"Player",team:"blue",x:0,y:0,vx:0,vy:0,ws,keys:{up:false,down:false,left:false,right:false}};players.set(id,p);autoTeams();for(const q of players.values())spawn(q);ws.send(JSON.stringify({type:"welcome",id}));broadcast();
ws.on("message",raw=>{try{const m=JSON.parse(raw);if(m.type==="name")p.name=String(m.name||"Player").slice(0,16).replace(/[<>]/g,"");if(m.type==="keys")p.keys={up:!!m.up,down:!!m.down,left:!!m.left,right:!!m.right}}catch{}});
ws.on("close",()=>{players.delete(id);broadcast()})});
let last=Date.now();setInterval(()=>{const n=Date.now(),dt=Math.min(.035,(n-last)/1000);last=n;physics(dt);broadcast()},1000/30);
server.listen(PORT,"0.0.0.0",()=>console.log("Ball Hax listening on "+PORT));
