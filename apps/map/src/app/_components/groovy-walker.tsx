"use client";

import { Lottie } from "lottie-react";

import groovyWalkAnimation from "../../assets/groovyWalk.json";

export const GroovyWalker = () => {
  return (
    <Lottie src={groovyWalkAnimation} className="h-16 w-16" autoplay loop />
  );
};
