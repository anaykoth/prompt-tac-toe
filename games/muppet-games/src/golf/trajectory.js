import { launch, stepBall } from './model.js';

export function predictShot(round,power=.65,face=0){
  const ball=launch({position:round.position,heading:round.heading,aim:round.aim,club:round.club,power,curve:face/16});
  const points=[{x:ball.x,y:ball.y,z:ball.z}];
  for(let i=0;i<4800&&!ball.stopped;i++){
    stepBall(ball,1/120);
    if(i%12===0||ball.stopped)points.push({x:ball.x,y:ball.y,z:ball.z});
  }
  return {points,ball};
}
