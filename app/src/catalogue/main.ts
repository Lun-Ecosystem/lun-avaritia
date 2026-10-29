// Development page only (catalogue.html): served by `vite dev`, left out of the build (vite.config.ts).
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/cormorant-garamond/500.css';
import '../lib/styles.css';
import { mount } from 'svelte';
import Catalogue from './Catalogue.svelte';

mount(Catalogue, { target: document.getElementById('catalogue')! });
