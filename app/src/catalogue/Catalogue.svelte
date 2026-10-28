<script lang="ts">
  import {
    AutoMark,
    Badge,
    Banner,
    bindShortcuts,
    BottomNav,
    Button,
    Checkbox,
    Chip,
    CodeInput,
    CommandPalette,
    ConfirmDialog,
    DayGroup,
    EmptyState,
    Fab,
    Field,
    IconButton,
    icons,
    Kbd,
    ListRow,
    Menu,
    NavGroup,
    NavLink,
    Popover,
    ProposalCard,
    ProposalChip,
    Rail,
    Segmented,
    ServiceCard,
    SettingsCard,
    SettingsRow,
    Skeleton,
    Slider,
    StandaloneCard,
    Steps,
    Tabs,
    TextInput,
    toast,
    Toaster,
    type ButtonVariant,
    type MenuSection,
    type NavItem,
    type PaletteCommand,
    type Tone,
  } from '../lib/ui/index.ts';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Switch from '../lib/ui/Switch.svelte';
  import type { ProposalView } from '../lib/types.ts';

  const variants: { value: ButtonVariant; label: string; role: string }[] = [
    { value: 'principal', label: 'Principal', role: 'L’action attendue, une seule par zone.' },
    { value: 'doux', label: 'Doux', role: 'Action recommandée secondaire.' },
    { value: 'secondaire', label: 'Secondaire', role: 'Alternative neutre.' },
    { value: 'fantome', label: 'Fantôme', role: 'Barres d’outils, actions répétées.' },
    { value: 'danger', label: 'Danger', role: 'Coupe un accès, retire une donnée.' },
    { value: 'danger-plein', label: 'Danger plein', role: 'Confirmation d’une action destructrice.' },
  ];

  const tones: { tone: Tone; label: string }[] = [
    { tone: 'ok', label: 'En service' },
    { tone: 'attention', label: 'Expire dans 10 j' },
    { tone: 'danger', label: 'Clé refusée' },
    { tone: 'info', label: 'Synchronisé' },
    { tone: 'ia', label: 'Proposition' },
    { tone: 'accent', label: 'Doublon' },
    { tone: 'neutre', label: 'Brouillon' },
  ];

  const boxes = [
    { value: 'factures', label: 'Factures' },
    { value: 'administratif', label: 'Administratif' },
    { value: 'newsletters', label: 'Newsletters' },
    { value: 'ecole', label: 'École' },
    { value: 'archives', label: 'Archives', disabled: true },
  ];

  const periods = [
    { value: 'jour', label: 'Jour' },
    { value: 'semaine', label: 'Semaine' },
    { value: 'mois', label: 'Mois' },
  ];

  let boxName = $state('');
  let box = $state('factures');
  let threshold = $state(85);
  let autoSort = $state(true);
  let notify = $state(false);
  let selected = $state(true);
  let period = $state('semaine');
  let filters = $state({ nonLus: true, ia: false, seuls: false });
  let lastShortcut = $state<string | null>(null);

  /** Shortcuts of the try-out, with their French key names. */
  const keyNames: Record<string, string> = {
    j: 'J',
    k: 'K',
    v: 'V',
    'Shift+v': 'Maj+V',
    '#': '#',
    Escape: 'Échap',
    'Ctrl+k': 'Ctrl K',
  };

  // 06 to 10: proposals, layers, structures, navigation (sample data, no real address).
  const proposal = (boxId: string | null, confidence: number): ProposalView => ({
    boxId,
    tagIds: [],
    confidence,
    status: 'pending',
  });
  let lastAction = $state<string | null>(null);
  const act = (what: string) => () => (lastAction = what);

  /** Colors of the sample boxes: data values, as the server sends them. */
  const boxColors = {
    factures: 'var(--lavis)',
    administratif: 'var(--attention)',
    newsletters: 'var(--ok)',
  };

  const sortSections: MenuSection[] = [
    { title: 'Suggéré', items: [{ id: 'factures', label: 'Factures', icon: icons.Sparkles, tone: 'ia' }] },
    {
      title: 'Boîtes',
      items: [
        { id: 'administratif', label: 'Administratif', color: boxColors.administratif, shortcut: '2' },
        { id: 'newsletters', label: 'Newsletters', color: boxColors.newsletters, shortcut: '3' },
      ],
    },
    { fixed: true, items: [{ id: 'nouvelle', label: 'Nouvelle boîte…', icon: icons.Plus }] },
  ];
  const moreSections: MenuSection[] = [
    {
      title: 'Ranger dans',
      items: [
        { id: 'factures', label: 'Factures', icon: icons.Folder, shortcut: '1' },
        { id: 'administratif', label: 'Administratif', icon: icons.Folder, shortcut: '2' },
        { id: 'newsletters', label: 'Newsletters', icon: icons.Folder, shortcut: '3' },
      ],
    },
    {
      items: [
        { id: 'nouvelle', label: 'Nouvelle boîte…', icon: icons.Plus },
        { id: 'corbeille', label: 'Corbeille', icon: icons.Trash, tone: 'danger' },
      ],
    },
  ];
  let menuChoice = $state<string | null>(null);

  let dialogOpen = $state(false);
  let confirmOpen = $state(false);
  let correctOpen = $state(false);
  let correctAnchor = $state<HTMLElement | null>(null);
  let correctBox = $state('administratif');
  let remember = $state(false);

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  function toastUndo() {
    toast('3 mails rangés dans Factures', { undo: () => wait(400) });
  }
  function toastRefused() {
    toast('Rangé dans Administratif : Impots.gouv', {
      undo: async () => {
        await wait(400);
        throw new Error('Le mail a changé depuis (déplacé dans Gmail), annulation refusée.');
      },
    });
  }

  let tab = $state('tout');
  const tabs = [
    { value: 'tout', label: 'Tout' },
    { value: 'non-lus', label: 'Non lus', count: 12 },
    { value: 'ia', label: 'Proposés par l’IA' },
    { value: 'seuls', label: 'Rangés seuls' },
  ];

  let paletteOpen = $state(false);
  const commands: PaletteCommand[] = [
    {
      id: 'ranger',
      label: 'Ranger la sélection dans Factures',
      group: 'Action',
      icon: icons.Folder,
      run: act('Ranger dans Factures'),
    },
    {
      id: 'chercher',
      label: 'Chercher « fac » dans les mails',
      group: 'Recherche',
      icon: icons.Search,
      run: act('Chercher'),
    },
    {
      id: 'reglages',
      label: 'Réglages, Boîtes et étiquettes',
      group: 'Aller à',
      icon: icons.Settings,
      run: act('Aller aux réglages'),
    },
    { id: 'pause', label: 'Mettre le tri en pause', group: 'Action', icon: icons.Pause, run: act('Pause') },
  ];

  const mobileNav: NavItem[] = [
    { href: '#mail', label: 'Mail', icon: icons.Mail },
    { href: '#a-valider', label: 'À valider', icon: icons.Sparkles, count: 3, countTone: 'ia' },
    { href: '#agenda', label: 'Agenda', icon: icons.Calendar },
    { href: '#reglages', label: 'Réglages', icon: icons.Settings },
  ];

  let code = $state('482');

  $effect(() =>
    bindShortcuts(
      Object.fromEntries(
        Object.entries(keyNames).map(([combo, name]) => [combo, () => (lastShortcut = name)]),
      ),
    ),
  );
</script>

<div class="lun-avaritia catalogue" data-monde="avaritia">
  <div class="page">
    <header class="intro">
      <span class="marque"><i aria-hidden="true"></i>Lun'Avaritia</span>
      <h1>Catalogue des composants</h1>
      <p>
        Chaque brique commune dans ses états, telle que les écrans l’assemblent. Les mesures et les couleurs
        sont celles de la planche 10, lues dans les jetons partagés.
      </p>
      <span class="note">Page de développement, absente de la version publiée.</span>
    </header>

    <!-- 01 Boutons -->
    <section class="bloc" aria-labelledby="s-boutons">
      <header>
        <span class="num">01</span>
        <h2 id="s-boutons">Boutons</h2>
      </header>
      <p class="pourquoi">
        Six niveaux, dont la confirmation destructrice. Les états survol et focus sont forcés pour la
        démonstration.
      </p>
      <div class="planche">
        <div class="matrice" role="table" aria-label="Boutons par niveau et par état">
          <div class="rang tete" role="row">
            <span role="columnheader">Niveau</span>
            {#each ['Normal', 'Survol', 'Focus', 'Désactivé', 'Chargement'] as state (state)}
              <span role="columnheader">{state}</span>
            {/each}
          </div>
          {#each variants as variant (variant.value)}
            <div class="rang" role="row">
              <span class="nom" role="rowheader">
                <b>{variant.label}</b>
                <small>{variant.role}</small>
              </span>
              <span class="cellule" role="cell" data-etat-nom="Normal">
                <Button variant={variant.value}>{variant.label}</Button>
              </span>
              <span class="cellule" role="cell" data-etat-nom="Survol">
                <Button variant={variant.value} data-etat="survol">{variant.label}</Button>
              </span>
              <span class="cellule" role="cell" data-etat-nom="Focus">
                <Button variant={variant.value} data-etat="focus">{variant.label}</Button>
              </span>
              <span class="cellule" role="cell" data-etat-nom="Désactivé">
                <Button variant={variant.value} disabled>{variant.label}</Button>
              </span>
              <span class="cellule" role="cell" data-etat-nom="Chargement">
                <Button variant={variant.value} loading>Vérification…</Button>
              </span>
            </div>
          {/each}
        </div>
        <p class="regle">
          <b>Règle :</b> un bouton en cours d’action garde sa largeur, affiche un indicateur et un verbe en cours
          (« Vérification… »).
        </p>
      </div>

      <div class="grille g2">
        <div class="planche">
          <h3>Tailles : 28, 34, 42 px</h3>
          <div class="ligne">
            <Button variant="principal" size="petit">Petit</Button>
            <Button variant="principal">Normal</Button>
            <Button variant="principal" size="grand">Grand</Button>
          </div>
          <div class="ligne">
            <Button variant="doux" size="petit" icon={icons.Check}>Valider</Button>
            <Button variant="secondaire" size="petit">Ranger ailleurs…</Button>
            <Button variant="fantome" size="petit">Garder en réception</Button>
          </div>
          <div class="ligne">
            <Button variant="fantome" icon={icons.Reply}>Répondre</Button>
            <Button variant="secondaire" icon={icons.Archive}>Archiver</Button>
            <Button variant="doux" size="grand" icon={icons.Check}>Valider la proposition</Button>
          </div>
        </div>
        <div class="planche">
          <h3>Bouton icône</h3>
          <div class="ligne">
            <IconButton icon={icons.Archive} label="Archiver" shortcut="E" />
            <IconButton icon={icons.Folder} label="Ranger" shortcut="C" />
            <IconButton icon={icons.Trash} label="Mettre à la corbeille" shortcut="#" />
            <IconButton icon={icons.Ellipsis} label="Plus d’actions" />
            <span class="legende">survoler pour l’info-bulle</span>
          </div>
          <div class="etats">
            <span class="etat"
              ><IconButton icon={icons.Archive} label="Archiver" data-etat="survol" /><small>Survol</small
              ></span
            >
            <span class="etat"
              ><IconButton icon={icons.Archive} label="Archiver" data-etat="focus" /><small>Focus</small
              ></span
            >
            <span class="etat"
              ><IconButton icon={icons.Archive} label="Archiver" disabled /><small>Désactivé</small></span
            >
            <span class="etat"
              ><IconButton icon={icons.Archive} label="Archiver" size="petit" /><small>Petit</small></span
            >
            <span class="etat"
              ><IconButton icon={icons.Plus} label="Nouveau message" variant="secondaire" /><small
                >Secondaire</small
              ></span
            >
            <span class="etat"
              ><IconButton icon={icons.Plus} label="Nouveau message" variant="principal" size="grand" /><small
                >Principal, grand</small
              ></span
            >
          </div>
          <p class="regle">
            <b>Règle :</b> un bouton icône a toujours un nom, lu et montré en info-bulle avec son raccourci.
          </p>
        </div>
      </div>
    </section>

    <!-- 02 Champs -->
    <section class="bloc" aria-labelledby="s-champs">
      <header>
        <span class="num">02</span>
        <h2 id="s-champs">Champs</h2>
      </header>
      <p class="pourquoi">
        Libellé au-dessus, aide en dessous, erreur à la place de l’aide, largeur selon le contenu attendu.
      </p>
      <div class="grille g3">
        <div class="planche col">
          <h3>Texte</h3>
          <Field label="Nom de la boîte" hint="Devient un libellé Gmail.">
            <TextInput bind:value={boxName} placeholder="Factures" />
          </Field>
          <Field label="Recherche" hint="Survol forcé.">
            <TextInput icon={icons.Search} placeholder="Chercher dans les mails" data-etat="survol" />
          </Field>
          <Field label="Nouvelle clé" hint="Vérifiée avant d’être enregistrée.">
            <TextInput icon={icons.Key} value="sk-ant-••••••••3f9a" data-etat="focus" />
          </Field>
        </div>
        <div class="planche col">
          <h3>Erreur, désactivé, suffixe</h3>
          <Field label="Code d’appairage" hint="Saisir le code à 6 chiffres." error="6 chiffres attendus.">
            <TextInput value="48 21" inputmode="numeric" />
          </Field>
          <Field label="Adresse du compte" hint="Fixée par la connexion Google.">
            <TextInput value="compte.test@example.com" disabled />
          </Field>
          <Field label="Rappel avant l’événement">
            <TextInput value="15" suffix="min" inputmode="numeric" class="etroit" />
          </Field>
        </div>
        <div class="planche col">
          <h3>Liste déroulante</h3>
          <Field label="Ranger dans" hint="Les boîtes viennent des libellés Gmail.">
            <Select items={boxes} bind:value={box} icon={icons.Folder} />
          </Field>
          <Field label="Boîte par défaut">
            <Select items={boxes} placeholder="Aucune boîte" data-etat="focus" />
          </Field>
          <Field label="Boîte des factures" error="Cette boîte n’existe plus dans Gmail.">
            <Select items={boxes} value="archives" />
          </Field>
          <Field label="Boîte des factures, focus" error="Cette boîte n’existe plus dans Gmail.">
            <Select items={boxes} value="archives" data-etat="focus" />
          </Field>
          <Field label="Boîte des spams">
            <Select items={boxes} value="newsletters" disabled />
          </Field>
        </div>
      </div>

      <div class="grille g2">
        <div class="planche col">
          <h3>Curseur avec sa valeur</h3>
          <Field label="Seuil « Tout valider »" hint="Sous ce seuil, l’IA propose et attend une validation.">
            <Slider bind:value={threshold} />
          </Field>
          <p class="legende">Valeur lue : {threshold}&nbsp;%</p>
          <Field label="Seuil d’auto-rangement" hint="Réglé par le tri, en pause.">
            <Slider value={95} disabled />
          </Field>
        </div>
        <div class="planche col">
          <h3>Commande segmentée</h3>
          <div class="etats">
            <span class="etat"
              ><Segmented options={periods} bind:value={period} label="Période" /><small>Normal</small></span
            >
            <span class="etat"
              ><Segmented
                options={periods}
                value="semaine"
                label="Période"
                data-etat="survol"
                etatValue="mois"
              /><small>Survol (Mois)</small></span
            >
            <span class="etat"
              ><Segmented
                options={periods}
                value="semaine"
                label="Période"
                data-etat="focus"
                etatValue="jour"
              /><small>Focus (Jour)</small></span
            >
            <span class="etat"
              ><Segmented options={periods} value="jour" label="Période" disabled /><small>Désactivé</small
              ></span
            >
            <span class="etat"
              ><Segmented options={periods} value="mois" label="Période" size="petit" /><small>Petit</small
              ></span
            >
          </div>
          <p class="legende">Choix courant : {periods.find((p) => p.value === period)?.label}</p>
        </div>
      </div>
    </section>

    <!-- 03 Bascules et cases -->
    <section class="bloc" aria-labelledby="s-bascules">
      <header>
        <span class="num">03</span>
        <h2 id="s-bascules">Bascules et cases</h2>
      </header>
      <p class="pourquoi">Une bascule agit tout de suite, sans bouton Enregistrer.</p>
      <div class="grille g2">
        <div class="planche reglages">
          <div class="reglage">
            <div class="txt"><b id="r-tri">Tri automatique</b><span>Range seul au-dessus du seuil</span></div>
            <Switch bind:checked={autoSort} aria-labelledby="r-tri" />
          </div>
          <div class="reglage">
            <div class="txt">
              <b id="r-notif">Notifications d’agenda</b><span>15 min avant chaque événement</span>
            </div>
            <Switch bind:checked={notify} aria-labelledby="r-notif" />
          </div>
          <div class="etats">
            <span class="etat"><Switch label="Survol" data-etat="survol" /><small>Survol</small></span>
            <span class="etat"><Switch label="Focus" checked data-etat="focus" /><small>Focus</small></span>
            <span class="etat"><Switch label="Désactivé" disabled /><small>Désactivé</small></span>
            <span class="etat"
              ><Switch label="Activé, désactivé" checked disabled /><small>Activé, désactivé</small></span
            >
          </div>
        </div>
        <div class="planche col">
          <h3>Cases</h3>
          <div class="ligne large">
            <Checkbox bind:checked={selected} label="Sélectionné" />
            <Checkbox label="Non sélectionné" />
            <Checkbox indeterminate label="Sélection partielle" />
          </div>
          <div class="etats">
            <span class="etat"><Checkbox aria-label="Survol" data-etat="survol" /><small>Survol</small></span>
            <span class="etat"
              ><Checkbox aria-label="Focus" checked data-etat="focus" /><small>Focus</small></span
            >
            <span class="etat"><Checkbox aria-label="Désactivé" disabled /><small>Désactivé</small></span>
            <span class="etat"
              ><Checkbox aria-label="Coché, désactivé" checked disabled /><small>Coché, désactivé</small
              ></span
            >
          </div>
        </div>
      </div>
    </section>

    <!-- 04 Pastilles -->
    <section class="bloc" aria-labelledby="s-pastilles">
      <header>
        <span class="num">04</span>
        <h2 id="s-pastilles">Pastilles et filtres</h2>
      </header>
      <p class="pourquoi">
        Un ton par sens : couleur, fond doux et bordure. Le ton IA marque ce que l’IA propose ou a fait seule.
      </p>
      <div class="grille g2">
        <div class="planche col">
          <h3>Badge d’état</h3>
          <div class="ligne">
            {#each tones as { tone, label } (tone)}
              {#if tone === 'ia'}
                <Badge {tone} icon={icons.Sparkles}>{label}</Badge>
              {:else}
                <Badge {tone} dot={tone !== 'neutre'}>{label}</Badge>
              {/if}
            {/each}
          </div>
          <div class="ligne">
            <Badge tone="ia" icon={icons.Check}>Rangé par l’IA dans Newsletters</Badge>
            <Badge>Aucune boîte trouvée</Badge>
          </div>
        </div>
        <div class="planche col">
          <h3>Pastilles de filtre</h3>
          <div class="ligne">
            <Chip on={filters.nonLus} count={12} onclick={() => (filters.nonLus = !filters.nonLus)}
              >Non lus</Chip
            >
            <Chip on={filters.ia} icon={icons.Sparkles} count={3} onclick={() => (filters.ia = !filters.ia)}>
              Proposés par l’IA
            </Chip>
            <Chip on={filters.seuls} onclick={() => (filters.seuls = !filters.seuls)}>Rangés seuls</Chip>
          </div>
          <div class="etats">
            <span class="etat"><Chip data-etat="survol">Factures</Chip><small>Survol</small></span>
            <span class="etat"><Chip data-etat="focus">Factures</Chip><small>Focus</small></span>
            <span class="etat"><Chip disabled>Factures</Chip><small>Désactivé</small></span>
          </div>
        </div>
      </div>
    </section>

    <!-- 05 Clavier -->
    <section class="bloc" aria-labelledby="s-clavier">
      <header>
        <span class="num">05</span>
        <h2 id="s-clavier">Clavier</h2>
      </header>
      <p class="pourquoi">
        Les raccourcis ne s’activent jamais dans un champ de saisie, sauf Ctrl K dans la palette.
      </p>
      <div class="grille g2">
        <div class="planche col">
          <h3>Essai</h3>
          <div class="ligne">
            {#each Object.values(keyNames) as name (name)}<Kbd>{name}</Kbd>{/each}
          </div>
          <p class="sortie" aria-live="polite">
            {#if lastShortcut}Dernier raccourci reçu : <b>{lastShortcut}</b>{:else}Aucun raccourci reçu.{/if}
          </p>
          <Field label="Champ de saisie" hint="Une touche tapée ici ne déclenche rien.">
            <TextInput placeholder="Taper J ou K ici" />
          </Field>
        </div>
        <div class="planche col">
          <h3>Typographie</h3>
          <div class="typo"><span class="t-page">Titre de page</span><small>Cormorant 500 · 34</small></div>
          <div class="typo">
            <span class="t-section">Titre de section</span><small>Cormorant 500 · 24</small>
          </div>
          <div class="typo"><span class="t-carte">Titre de carte</span><small>Cormorant 500 · 19</small></div>
          <div class="typo">
            <span class="t-libelle">Libellé, bouton, ligne de liste</span><small>Inter 400 · 14</small>
          </div>
          <div class="typo">
            <span class="t-courant">Texte courant, lecture d’un mail</span><small>Inter 300 · 14</small>
          </div>
          <div class="typo">
            <span class="t-aide">Aide, légende, horodatage</span><small>Inter 300 · 12,5</small>
          </div>
          <div class="typo">
            <span class="t-surtitre">Sur-titre de groupe</span><small>Inter 500 · 11</small>
          </div>
        </div>
      </div>
    </section>

    <!-- 06 L'IA -->
    <section class="bloc" aria-labelledby="s-ia">
      <header>
        <span class="num">06</span>
        <h2 id="s-ia">L’IA visible et contrôlable</h2>
      </header>
      <p class="pourquoi">
        La proposition dit ce que l’IA veut faire, avec quelle confiance, et se valide ou se corrige en un
        geste. Version compacte dans la liste, version complète dans la lecture.
      </p>
      <div class="grille g2">
        <div class="planche col">
          <h3>Dans la liste (compacte)</h3>
          <div class="ligne">
            <ProposalChip
              proposal={proposal('spam', 70)}
              boxName="Spam"
              onvalidate={act('Valider : Spam')}
              oncorrect={act('Corriger : Spam')}
            />
            <ProposalChip
              proposal={proposal('factures', 92)}
              boxName="Factures"
              tagNames={['Urgent']}
              onvalidate={act('Valider : Factures + Urgent')}
              oncorrect={act('Corriger : Factures + Urgent')}
            />
          </div>
          <div class="ligne">
            <AutoMark boxName="Newsletters" /><span class="legende">déjà fait seul, annulable</span>
          </div>
          <div class="ligne">
            <ProposalChip proposal={proposal(null, 40)} boxName="" onvalidate={act('')} oncorrect={act('')} />
            <span class="legende">au lieu de « Aucune boîte ? »</span>
          </div>
          <p class="sortie" aria-live="polite">
            {#if lastAction}Dernière action : <b>{lastAction}</b>{:else}Aucune action.{/if}
          </p>
        </div>
        <div class="planche col">
          <h3>Dans la lecture (complète)</h3>
          <ProposalCard
            proposal={proposal('spam', 70)}
            boxName="Spam"
            reason="Expéditeur inconnu, aucun échange précédent, objet générique."
            threshold={95}
            onvalidate={act('Valider : Spam')}
            oncorrect={(anchor) => {
              correctAnchor = anchor;
              correctOpen = true;
            }}
            onkeep={act('Garder en réception')}
          />
          <p class="regle">
            <b>Règle :</b> la justification vient du classifieur (160 caractères au plus) ; sous le seuil d’auto-rangement,
            la carte dit pourquoi elle attend. « Ranger ailleurs… » ouvre la bulle de correction.
          </p>
        </div>
      </div>
    </section>

    <!-- 07 Calques -->
    <section class="bloc" aria-labelledby="s-calques">
      <header>
        <span class="num">07</span>
        <h2 id="s-calques">Ce qui flotte : menus, info-bulles, dialogues, toasts</h2>
      </header>
      <p class="pourquoi">
        Tout ce qui flotte passe par un calque au-dessus de l’application : placé seul, retourné s’il manque
        de place, fermé par Échap et au clic dehors, focus clavier gardé.
      </p>
      <div class="grille g2">
        <div class="planche">
          <h3>Menu ancré dans un conteneur qui coupe</h3>
          <div class="scene">
            <div class="scene-gauche">
              <ListRow selected>
                <div class="l1"><span class="de">Free Mobile</span><span class="heure">09:12</span></div>
                <div class="l2"><b>Votre facture</b> · disponible</div>
              </ListRow>
              <div class="ligne scene-actions">
                <Menu
                  sections={sortSections}
                  filter="Filtrer les boîtes"
                  onselect={(id) => (menuChoice = id)}
                >
                  {#snippet trigger({ props })}
                    <Button {...props} variant="secondaire" size="petit" icon={icons.Folder}
                      >Ranger dans</Button
                    >
                  {/snippet}
                </Menu>
                <Menu sections={moreSections} onselect={(id) => (menuChoice = id)} label="Plus d’actions">
                  {#snippet trigger({ props })}
                    <IconButton {...props} icon={icons.Ellipsis} label="Plus d’actions" size="petit" />
                  {/snippet}
                </Menu>
              </div>
            </div>
            <div class="scene-droite">Lecture</div>
          </div>
          <p class="regle">
            <b>Preuve :</b> la scène coupe ce qui dépasse (overflow hidden, 260 px de haut) ; le menu ouvert
            la dépasse en entier. Choix reçu : <b>{menuChoice ?? 'aucun'}</b>.
          </p>
        </div>
        <div class="planche col">
          <h3>Info-bulle, bulle, dialogues</h3>
          <div class="ligne">
            <IconButton icon={icons.Archive} label="Archiver" shortcut="E" />
            <span class="legende">survoler ou atteindre au clavier</span>
          </div>
          <div class="ligne">
            <Popover label="Corriger la proposition" width={290}>
              {#snippet trigger({ props })}
                <Button {...props} variant="secondaire" size="petit">Corriger…</Button>
              {/snippet}
              {#snippet children({ close })}
                {@render corriger(close)}
              {/snippet}
            </Popover>
            <Button variant="secondaire" size="petit" onclick={() => (dialogOpen = true)}
              >Ouvrir un dialogue</Button
            >
            <Button variant="danger" size="petit" onclick={() => (confirmOpen = true)}
              >Retirer l’appareil…</Button
            >
          </div>
          <h3>Toasts et bandeaux</h3>
          <div class="ligne">
            <Button variant="secondaire" size="petit" onclick={toastUndo}>Toast annulable</Button>
            <Button variant="secondaire" size="petit" onclick={toastRefused}>Annulation refusée</Button>
            <Button variant="fantome" size="petit" onclick={() => toast('Réglage enregistré')}
              >Toast simple</Button
            >
          </div>
          <Banner title="Clé Anthropic refusée : le tri par l’IA est en pause.">
            Les règles continuent de s’appliquer. Les nouveaux mails restent en réception.
            {#snippet action()}<Button variant="principal" size="petit">Remplacer la clé</Button>{/snippet}
          </Banner>
          <Banner tone="attention" title="La clé expire dans 10 jours."
            >Échéance déclarée : 12 mars 2027.</Banner
          >
        </div>
      </div>
    </section>

    <!-- 08 Structures -->
    <section class="bloc" aria-labelledby="s-structures">
      <header>
        <span class="num">08</span>
        <h2 id="s-structures">Structures : listes, cartes de réglages, états vides, chargement</h2>
      </header>
      <p class="pourquoi">
        Les écrans se composent de ces structures. Une ligne montre l’essentiel sans couper l’objet ; les
        actions apparaissent au survol. Un état vide explique et propose quoi faire.
      </p>
      <div class="grille g2">
        <div class="planche flush">
          <h3 class="flush-titre">Lignes de liste, groupées par jour</h3>
          <DayGroup label="Aujourd’hui">
            <ListRow onopen={act('Ouvrir : Free Mobile')}>
              {#snippet start()}<Checkbox aria-label="Sélectionner" /><span class="avatar">FM</span>{/snippet}
              <div class="l1">
                <span class="de">Free Mobile</span>
                <ProposalChip
                  proposal={proposal('factures', 92)}
                  boxName="Factures"
                  onvalidate={act('Valider : Factures')}
                  oncorrect={act('Corriger : Factures')}
                />
                <span class="heure">09:12</span>
              </div>
              <div class="l2">
                <b>Votre facture d’octobre est disponible</b> · Montant 19,99 €, prélevé le 5 novembre
              </div>
            </ListRow>
            <ListRow selected>
              {#snippet start()}<Checkbox aria-label="Sélectionner" checked /><span class="avatar">CT</span
                >{/snippet}
              <div class="l1"><span class="de">Compte test</span><span class="heure">00:28</span></div>
              <div class="l2"><b>Essai de clé</b> · Message de test envoyé depuis un téléphone</div>
            </ListRow>
          </DayGroup>
          <DayGroup label="Hier">
            <ListRow read data-etat="survol">
              {#snippet start()}<Checkbox aria-label="Sélectionner" /><span class="avatar">G</span>{/snippet}
              <div class="l1"><span class="de">Google</span><span class="heure">hier</span></div>
              <div class="l2"><b>Alerte de sécurité</b> · Nouvelle connexion sur Windows</div>
              {#snippet actions()}
                <IconButton icon={icons.Archive} label="Archiver" shortcut="E" size="petit" />
                <IconButton icon={icons.Folder} label="Ranger" shortcut="R" size="petit" />
                <IconButton icon={icons.Trash} label="Mettre à la corbeille" shortcut="#" size="petit" />
                <IconButton icon={icons.Clock} label="Plus tard" size="petit" />
              {/snippet}
            </ListRow>
          </DayGroup>
          <p class="regle flush-regle">
            <b>Règle :</b> objet et début du message sur une ligne entière ; actions au survol et au clavier (survol
            forcé sur la dernière ligne).
          </p>
        </div>
        <SettingsCard title="Compte Google" description="Mail, agenda et tâches passent par ce compte.">
          {#snippet aside()}<Badge tone="ok" dot>Connecté</Badge>{/snippet}
          <SettingsRow label="compte.test@example.com" hint="Relié le 14 sept. 2026">
            {#snippet start()}<span class="avatar grand">CT</span>{/snippet}
          </SettingsRow>
          <SettingsRow label="Autorisations" hint="Gmail (lecture, modification) · Agenda · Tâches">
            <Button variant="fantome" size="petit">Détails</Button>
          </SettingsRow>
          <SettingsRow label="Tri automatique" hint="Range seul au-dessus du seuil.">
            {#snippet children({ labelId })}<Switch checked aria-labelledby={labelId} />{/snippet}
          </SettingsRow>
          <SettingsRow label="Déconnecter le compte" hint="Le tri et la synchronisation s’arrêtent.">
            <Button variant="danger" size="petit">Déconnecter</Button>
          </SettingsRow>
        </SettingsCard>
        <div class="planche">
          <h3>État vide</h3>
          <EmptyState
            title="Rien n’attend de validation"
            message="Les prochaines propositions de l’IA apparaîtront ici. Les mails rangés seuls restent visibles dans le journal."
          >
            <Button variant="secondaire" size="petit" icon={icons.Clock}>Voir le journal</Button>
          </EmptyState>
          <EmptyState
            size="grand"
            title="Rien à valider"
            message="Toutes les propositions sont traitées. Les prochains mails incertains arriveront ici."
          >
            <div class="stats">
              <div class="stat"><b>14</b>rangés seuls aujourd’hui</div>
              <div class="stat"><b>4</b>validés</div>
              <div class="stat"><b>1</b>corrigé</div>
            </div>
          </EmptyState>
        </div>
        <div class="planche col" aria-busy="true">
          <h3>Chargement (squelette, pas de texte « Chargement… »)</h3>
          {#each [[40, 85], [30, 70], [45, 78]] as [a, b] (a)}
            <div class="ligne squelettes">
              <Skeleton shape="rond" />
              <div class="col serre">
                <Skeleton width="{a}%" />
                <Skeleton width="{b}%" />
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>

    <!-- 09 Navigation -->
    <section class="bloc" aria-labelledby="s-navigation">
      <header>
        <span class="num">09</span>
        <h2 id="s-navigation">Navigation : rail, onglets, palette de commandes</h2>
      </header>
      <p class="pourquoi">
        Un rail à gauche avec icônes, libellés et compteurs, l’état du service en bas ; des onglets soulignés
        pour les sous-vues ; une palette Ctrl K pour tout faire au clavier.
      </p>
      <div class="grille g3">
        <div class="planche rail-cadre">
          <Rail label="Navigation du catalogue">
            {#snippet header()}
              <span class="marque petite"><i aria-hidden="true"></i>Lun'Avaritia</span>
              <Button variant="principal" icon={icons.Plus} class="plein">Nouveau message</Button>
            {/snippet}
            <NavLink href="#reception" label="Réception" icon={icons.Inbox} count={12} current />
            <NavLink href="#a-valider" label="À valider" icon={icons.Sparkles} count={3} countTone="ia" />
            <NavLink href="#agenda" label="Agenda" icon={icons.Calendar} data-etat="survol" />
            <NavLink href="#taches" label="Tâches" icon={icons.List} count={4} data-etat="focus" />
            <NavGroup title="Boîtes">
              {#snippet action()}<IconButton
                  icon={icons.Plus}
                  label="Nouvelle boîte"
                  size="petit"
                />{/snippet}
              <NavLink href="#factures" label="Factures" color={boxColors.factures} count={2} />
              <NavLink href="#administratif" label="Administratif" color={boxColors.administratif} />
              <NavLink href="#newsletters" label="Newsletters" color={boxColors.newsletters} count={18} />
            </NavGroup>
            {#snippet footer()}
              <NavLink href="#journal" label="Journal" icon={icons.Clock} />
              <NavLink href="#reglages" label="Réglages" icon={icons.Settings} />
              <ServiceCard state="actif" detail="Synchronisé il y a 1 min" />
            {/snippet}
          </Rail>
        </div>
        <div class="planche col">
          <h3>État du service</h3>
          <ServiceCard state="actif" detail="Seuil d’auto-rangement : 95 %" />
          <ServiceCard state="pause" detail="Mis en pause à 08:40" />
          <ServiceCard state="cle-refusee" detail="Clé refusée" />
        </div>
        <div class="planche col">
          <h3>Palette Ctrl K</h3>
          <p class="legende">Ctrl K l’ouvre et la ferme, y compris depuis son champ de recherche.</p>
          <div class="ligne">
            <Button variant="secondaire" icon={icons.Search} onclick={() => (paletteOpen = true)}>
              Ouvrir la palette
            </Button>
            <Kbd>Ctrl K</Kbd>
          </div>
          <h3>Colonne de thèmes</h3>
          <Rail label="Thèmes des réglages" variant="themes" title="Réglages">
            <NavGroup title="Compte">
              <NavLink href="#compte" label="Compte Google" icon={icons.Mail} />
              <NavLink href="#appareils" label="Appareils et applications" icon={icons.Eye} />
            </NavGroup>
            <NavGroup title="Tri">
              <NavLink href="#tri" label="Tri par l’IA" icon={icons.Sparkles} current />
              <NavLink href="#boites" label="Boîtes et règles" icon={icons.Folder} />
            </NavGroup>
          </Rail>
        </div>
      </div>
      <div class="planche col onglets-demo">
        <h3>Onglets</h3>
        <Tabs items={tabs} bind:value={tab} label="Filtre de la liste" etat={['non-lus', 'survol']} />
        <p class="legende">Onglet courant : {tabs.find((t) => t.value === tab)?.label}</p>
        <p class="regle">
          <b>Règle :</b> l’onglet actif est souligné en accent, jamais seulement « un peu plus clair ».
        </p>
      </div>
    </section>

    <!-- 10 Mobile et pages seules -->
    <section class="bloc" aria-labelledby="s-mobile">
      <header>
        <span class="num">10</span>
        <h2 id="s-mobile">Mobile et pages seules</h2>
      </header>
      <p class="pourquoi">
        Sous 768 px : navigation en bas, bouton flottant pour l’action principale. Avant d’être dans l’app :
        une carte centrée sur fond encre, la saisie du code en six cases, les étapes.
      </p>
      <div class="grille mobile-grille">
        <div class="telephone">
          <div class="tel-liste">
            <DayGroup label="Aujourd’hui">
              <ListRow>
                {#snippet start()}<span class="avatar">FM</span>{/snippet}
                <div class="l1"><span class="de">Free Mobile</span><span class="heure">09:12</span></div>
                <div class="l2"><b>Votre facture d’octobre est disponible</b></div>
                <div class="l3">
                  <ProposalChip
                    proposal={proposal('factures', 92)}
                    boxName="Factures"
                    onvalidate={act('Valider : Factures')}
                    oncorrect={act('Corriger : Factures')}
                  />
                </div>
              </ListRow>
              <ListRow>
                {#snippet start()}<span class="avatar">IM</span>{/snippet}
                <div class="l1"><span class="de">Impots.gouv</span><span class="heure">08:47</span></div>
                <div class="l2"><b>Votre avis de taxe foncière est disponible</b></div>
                <div class="l3"><AutoMark boxName="Administratif" /></div>
              </ListRow>
            </DayGroup>
          </div>
          <Fab label="Nouveau" icon={icons.Plus} />
          <BottomNav items={mobileNav} current="#mail" />
        </div>
        <div class="cadre-seul">
          <StandaloneCard
            title="Relier ce navigateur"
            lead="Saisir le code à 6 chiffres. Il ne sert qu’une fois."
          >
            <Field label="Code d’appairage" hint="Le code peut être collé tel quel.">
              <CodeInput bind:value={code} oncomplete={act('Code complet')} data-etat="focus" />
            </Field>
            <div class="espace"></div>
            <Button variant="principal" size="grand" class="plein" disabled={code.length < 6}>Relier</Button>
          </StandaloneCard>
        </div>
        <div class="cadre-seul">
          <StandaloneCard title="Autoriser l’application" lead="Code refusé : la même carte, en erreur.">
            {#snippet steps()}<Steps steps={['Navigateur relié', 'Autoriser']} current={1} />{/snippet}
            <Field label="Code d’appairage" error="Code incorrect ou expiré. Demander un nouveau code.">
              <CodeInput value="482917" />
            </Field>
            <div class="espace"></div>
            <Button variant="principal" size="grand" class="plein">Réessayer</Button>
          </StandaloneCard>
        </div>
      </div>
    </section>
  </div>

  {#snippet corriger(close: () => void)}
    <div class="corriger">
      <p class="titre-menu">Ranger dans</p>
      <Segmented
        options={[
          { value: 'administratif', label: 'Administratif' },
          { value: 'factures', label: 'Factures' },
          { value: 'reception', label: 'Réception' },
        ]}
        bind:value={correctBox}
        label="Boîte"
        size="petit"
      />
      <Checkbox bind:checked={remember} label="Retenir pour cet expéditeur" />
      <div class="ligne fin">
        <Button variant="fantome" size="petit" onclick={close}>Annuler</Button>
        <Button
          variant="principal"
          size="petit"
          onclick={() => {
            lastAction = `Corrigé : ${correctBox}${remember ? ', règle créée' : ''}`;
            close();
          }}>Appliquer</Button
        >
      </div>
    </div>
  {/snippet}

  <Popover bind:open={correctOpen} anchor={correctAnchor} label="Corriger la proposition" width={290}>
    {#snippet children({ close })}{@render corriger(close)}{/snippet}
  </Popover>

  <Dialog
    bind:open={dialogOpen}
    title="Nouvel événement"
    description="Une seule fenêtre pour créer ou modifier."
  >
    <Field label="Titre"><TextInput placeholder="Réunion de rentrée" /></Field>
    {#snippet footer({ close })}
      <Button variant="secondaire" onclick={close}>Annuler</Button>
      <Button variant="principal" onclick={close}>Créer</Button>
    {/snippet}
  </Dialog>

  <ConfirmDialog
    bind:open={confirmOpen}
    title="Retirer Safari sur iPhone ?"
    message="Cet appareil perdra l’accès à Lun'Avaritia. Un nouveau code sera nécessaire pour le relier."
    confirmLabel="Retirer l’appareil"
    onconfirm={async () => {
      await wait(600);
      lastAction = 'Appareil retiré';
    }}
  />

  <CommandPalette bind:open={paletteOpen} {commands} />
  <Toaster />
</div>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    background: var(--fond);
  }
  .catalogue {
    min-height: 100vh;
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    max-width: 1240px;
    margin: 0 auto;
    padding: 40px 32px 120px;
  }

  .intro h1 {
    margin: 14px 0 8px;
    font: 500 40px/1.1 var(--serif);
  }
  .intro p {
    max-width: 760px;
    margin: 0 0 6px;
    color: var(--texte-2);
  }
  .marque {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font: 500 18px var(--serif);
  }
  .marque i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-doux);
  }
  .note {
    display: inline-flex;
    margin-top: 10px;
    padding: 3px 10px;
    border: 1px dashed var(--bordure-forte);
    border-radius: var(--r-rond);
    font-size: 12px;
    color: var(--texte-3);
  }

  .bloc {
    margin-top: 56px;
  }
  .bloc > header {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-bottom: 6px;
  }
  .num {
    font: 500 13px var(--sans);
    letter-spacing: 0.08em;
    color: var(--accent-texte);
  }
  h2 {
    margin: 0;
    font: 500 28px/1.2 var(--serif);
  }
  .pourquoi {
    max-width: 880px;
    margin: 0 0 18px;
    color: var(--texte-2);
  }

  .grille {
    display: grid;
    gap: 16px;
    margin-top: 16px;
  }
  .g2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .g3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .planche {
    padding: 20px;
    background: var(--surface-1);
    border: 1px solid var(--bordure);
    border-radius: var(--r-3);
  }
  .planche h3 {
    margin: 0 0 14px;
    font: 500 13px var(--sans);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--texte-3);
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .col h3 {
    margin-bottom: 0;
  }
  .ligne {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .planche > .ligne + .ligne {
    margin-top: 12px;
  }
  .ligne.large {
    gap: 22px;
  }
  .legende {
    margin: 0;
    font-size: 12.5px;
    color: var(--texte-3);
  }
  .regle {
    margin: 16px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--bordure);
    font-size: 12.5px;
    color: var(--texte-3);
  }
  .regle b {
    font-weight: 500;
    color: var(--texte-2);
  }
  .planche :global(.etroit) {
    max-width: 120px;
  }

  /* Variant by state matrix */
  .matrice {
    display: flex;
    flex-direction: column;
  }
  .rang {
    display: grid;
    grid-template-columns: minmax(180px, 1.3fr) repeat(5, minmax(0, 1fr));
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-top: 1px solid var(--bordure);
  }
  .rang.tete {
    padding-top: 0;
    border-top: 0;
    font: 500 11px var(--sans);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--texte-3);
  }
  .nom {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .nom b {
    font-weight: 400;
  }
  .nom small {
    font-size: 12.5px;
    color: var(--texte-3);
  }
  .cellule {
    display: flex;
    min-width: 0;
  }

  /* Small state samples, captioned */
  .etats {
    display: flex;
    flex-wrap: wrap;
    gap: 18px 22px;
    margin-top: 14px;
  }
  .col .etats {
    margin-top: 0;
  }
  .etat {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .etat small {
    font-size: 11.5px;
    color: var(--texte-3);
  }

  .reglages {
    padding: 4px 20px 20px;
  }
  .reglage {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 14px 0;
    border-bottom: 1px solid var(--bordure);
  }
  .txt {
    flex: 1;
    min-width: 0;
  }
  .txt b {
    display: block;
    font-weight: 400;
  }
  .txt span {
    font-size: 12.5px;
    color: var(--texte-3);
  }

  .sortie {
    margin: 0;
    color: var(--texte-2);
  }
  .sortie b {
    font-weight: 500;
    color: var(--accent-texte);
  }

  .typo {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--bordure);
  }
  .typo:last-child {
    border-bottom: 0;
  }
  .typo small {
    font: 300 12px var(--sans);
    color: var(--texte-3);
    white-space: nowrap;
  }
  .col .typo {
    margin-top: -8px;
  }
  .t-page {
    font: 500 34px/1.15 var(--serif);
  }
  .t-section {
    font: 500 24px/1.2 var(--serif);
  }
  .t-carte {
    font: 500 19px/1.25 var(--serif);
  }
  .t-libelle {
    font: 400 14px var(--sans);
  }
  .t-courant {
    font: 300 14px var(--sans);
  }
  .t-aide {
    font: 300 12.5px var(--sans);
    color: var(--texte-3);
  }
  .t-surtitre {
    font: 500 11px var(--sans);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--texte-3);
  }

  /* 06 to 10 */
  .scene {
    position: relative;
    height: 260px;
    overflow: hidden;
    background: var(--fond);
    border: 1px solid var(--bordure);
    border-radius: var(--r-3);
  }
  .scene-gauche {
    position: absolute;
    inset: 0 55% 0 0;
    padding: 14px;
    border-right: 1px solid var(--bordure);
  }
  .scene-gauche :global(.rangee) {
    border-radius: var(--r-2);
    border-bottom: 0;
    min-height: 52px;
  }
  .scene-actions {
    margin-top: 12px;
  }
  .scene-droite {
    position: absolute;
    inset: 0 0 0 45%;
    display: grid;
    place-items: center;
    font-size: 13px;
    color: var(--texte-3);
  }
  .l1 {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .l2 {
    margin-top: 1px;
    overflow: hidden;
    font-size: 13px;
    color: var(--texte-2);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .l2 b {
    font-weight: 400;
    color: var(--texte);
  }
  .l3 {
    margin-top: 6px;
  }
  /* A read row: lighter sender and subject. */
  :global(.lu) .de,
  :global(.lu) .l2 b {
    font-weight: 300;
    color: var(--texte-2);
  }
  .de {
    font-weight: 500;
    white-space: nowrap;
  }
  .heure {
    margin-left: auto;
    font-size: 12px;
    color: var(--texte-3);
    white-space: nowrap;
  }
  .avatar {
    display: grid;
    place-items: center;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--surface-3);
    color: var(--texte-2);
    font: 500 11.5px var(--sans);
  }
  .avatar.grand {
    width: 36px;
    height: 36px;
  }
  .flush {
    padding: 0;
    overflow: hidden;
  }
  .flush-titre {
    padding: 16px 18px 0;
  }
  .flush-regle {
    margin: 0;
    padding: 12px 18px 14px;
    border-top: 0;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
  }
  .stat {
    padding: 10px 16px;
    background: var(--surface-1);
    border: 1px solid var(--bordure);
    border-radius: var(--r-2);
    font-size: 12.5px;
    color: var(--texte-3);
    text-align: left;
  }
  .stat b {
    display: block;
    font: 500 20px var(--sans);
    color: var(--texte);
  }
  .squelettes {
    flex-wrap: nowrap;
  }
  .serre {
    flex: 1;
    gap: 8px;
  }
  .rail-cadre {
    display: flex;
    padding: 0;
    overflow: hidden;
  }
  .rail-cadre :global(.rail) {
    width: 100%;
    border-right: 0;
    background: none;
  }
  .marque.petite {
    padding: 2px 8px 0;
    font-size: 21px;
  }
  .planche :global(.plein),
  .cadre-seul :global(.plein) {
    width: 100%;
  }
  .planche :global(.rail.themes) {
    width: 100%;
    padding: 4px 0;
    border-right: 0;
    background: none;
  }
  .corriger {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 6px 8px;
  }
  .titre-menu {
    margin: 0;
    font: 500 10.5px var(--sans);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--texte-3);
  }
  .fin {
    justify-content: flex-end;
    gap: 6px;
  }
  .mobile-grille {
    grid-template-columns: 390px repeat(2, minmax(0, 1fr));
    align-items: start;
  }
  /* A transformed frame contains the fixed bar and button, as a phone screen would. */
  .telephone {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 720px;
    overflow: hidden;
    background: var(--fond);
    border: 1px solid var(--bordure-forte);
    border-radius: 28px;
    transform: translateZ(0);
  }
  .tel-liste {
    flex: 1;
    min-height: 0;
    padding-top: 8px;
  }
  .telephone :global(.barre) {
    padding-bottom: 0;
  }
  .onglets-demo {
    margin-top: 16px;
  }
  .cadre-seul {
    display: flex;
    height: 720px;
    overflow: hidden;
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-3);
  }
  .cadre-seul :global(.seul) {
    flex: 1;
  }
  .espace {
    height: 18px;
  }
  @media (max-width: 1240px) {
    .mobile-grille {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 1100px) {
    .g3 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 900px) {
    .g2,
    .g3,
    .mobile-grille {
      grid-template-columns: minmax(0, 1fr);
    }
    .rang {
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    }
    .rang.tete {
      display: none;
    }
    .nom {
      grid-column: 1 / -1;
    }
    .cellule {
      flex-direction: column;
      gap: 6px;
    }
    .cellule::after {
      content: attr(data-etat-nom);
      font-size: 11.5px;
      color: var(--texte-3);
    }
  }
  @media (max-width: 600px) {
    .page {
      padding: 28px 16px 80px;
    }
    .intro h1 {
      font-size: 32px;
    }
    .planche {
      padding: 16px;
    }
    .planche.flush {
      padding: 0;
    }
    .l1 {
      flex-wrap: wrap;
      row-gap: 4px;
    }
    .reglages {
      padding: 4px 16px 16px;
    }
  }
</style>
