"use client";

import React, { useRef, useEffect } from "react";
import * as THREE from "three";

export default function RacingScene() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    // Create scene, camera, and renderer
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a0a, 0.015);

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      1,
      1000
    );
    camera.position.z = 100;
    camera.position.y = 15;

    // Phones/tablets: cheaper rendering (no MSAA, capped pixel ratio, fewer particles)
    // and no motion at all if the user has asked the OS to reduce it.
    const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // WebGL can be unavailable or refuse a new context (browser context limit,
    // blocklisted GPU). The flat background underneath is a fine fallback -- don't
    // let a decorative layer take the whole landing page down.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isCoarsePointer,
        alpha: true,
        powerPreference: "low-power",
      });
    } catch (err) {
      console.warn("RacingScene: WebGL unavailable, falling back to flat background", err);
      return;
    }
    renderer.setSize(container.clientWidth, container.clientHeight);
    // Full devicePixelRatio is 3x on many phones (9x the pixels) for a background layer.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isCoarsePointer ? 1.5 : 2));
    container.appendChild(renderer.domElement);

    // Create a 3D grid to simulate a digital race track surface
    const gridHelper = new THREE.GridHelper(300, 40, 0x1f2833, 0x15151e);
    gridHelper.position.y = -10;
    scene.add(gridHelper);

    // Create drifting digital particle points
    const particleCount = isCoarsePointer ? 120 : 250;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const cyan = new THREE.Color(0x66fcf1);
    const red = new THREE.Color(0xe10600);

    for (let i = 0; i < particleCount; i++) {
      // Spread coordinates
      positions[i * 3] = (Math.random() - 0.5) * 400; // x
      positions[i * 3 + 1] = Math.random() * 50 - 10; // y
      positions[i * 3 + 2] = (Math.random() - 0.5) * 400; // z

      // Mix cyan and red color highlights
      const mixedColor = Math.random() > 0.5 ? cyan : red;
      colors[i * 3] = mixedColor.r;
      colors[i * 3 + 1] = mixedColor.g;
      colors[i * 3 + 2] = mixedColor.b;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Particle texture
    const material = new THREE.PointsMaterial({
      size: 1.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    // Animate
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Rotate grid slowly
      gridHelper.rotation.y += 0.0005;

      // Move particles forward slowly
      const posArr = geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount; i++) {
        posArr[i * 3 + 2] += 0.15; // Move z forward

        // Reset when too close to camera
        if (posArr[i * 3 + 2] > 150) {
          posArr[i * 3 + 2] = -250;
        }
      }
      geometry.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
    };

    // Pause the render loop when the tab isn't visible — this is a permanent
    // full-screen background layer, so an unthrottled loop burns CPU/GPU/battery
    // on every hidden tab indefinitely.
    const stopAnimating = () => {
      cancelAnimationFrame(animationFrameId);
    };
    const handleVisibilityChange = () => {
      if (prefersReducedMotion) return;
      if (document.hidden) {
        stopAnimating();
      } else {
        animate();
      }
    };
    if (prefersReducedMotion) {
      renderer.render(scene, camera); // one still frame, no loop
    } else if (!document.hidden) {
      animate();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Mobile browsers reclaim WebGL contexts under memory pressure. Without
    // preventDefault the context can never be restored; without stopping the
    // loop we'd keep issuing draw calls against a dead context.
    const canvas = renderer.domElement;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      stopAnimating();
    };
    const handleContextRestored = () => {
      if (prefersReducedMotion || document.hidden) {
        renderer.render(scene, camera);
      } else {
        animate();
      }
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    // Handle resize (debounced — resizing the window shouldn't thrash the renderer)
    let resizeTimeout: ReturnType<typeof setTimeout> | undefined;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (!container) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
        if (prefersReducedMotion) renderer.render(scene, camera);
      }, 150);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      clearTimeout(resizeTimeout);
      cancelAnimationFrame(animationFrameId);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full opacity-35" />;
}
