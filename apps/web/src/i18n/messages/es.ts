import type { Messages } from './en';

export const es = {
  app: {
    name: 'Spending',
    tagline: 'Tu dinero, con calma y en orden',
  },
  nav: {
    label: 'Navegación principal',
    skipToContent: 'Saltar al contenido',
    more: 'Más',
    moreTitle: 'Todas las secciones',
    dashboard: 'Resumen',
    transactions: 'Movimientos',
    budgets: 'Presupuestos',
    recurring: 'Recurrentes',
    accounts: 'Cuentas',
    categories: 'Categorías',
    imports: 'Importar',
    family: 'Familia',
    settings: 'Ajustes',
    sync: 'Sincronización',
    addTransaction: 'Añadir movimiento',
  },
  actions: {
    add: 'Añadir',
    save: 'Guardar',
    cancel: 'Cancelar',
    delete: 'Eliminar',
    edit: 'Editar',
    close: 'Cerrar',
    confirm: 'Confirmar',
    retry: 'Reintentar',
    back: 'Atrás',
    continue: 'Continuar',
    search: 'Buscar',
    filter: 'Filtrar',
    undo: 'Deshacer',
    done: 'Hecho',
    signOut: 'Cerrar sesión',
    goHome: 'Ir al resumen',
  },
  states: {
    loading: 'Cargando…',
    empty: {
      title: 'Aún no hay nada aquí',
      description: 'Cuando haya algo que mostrar, aparecerá aquí.',
    },
    offline: {
      title: 'Sin conexión',
      description:
        'Los cambios se guardan en este dispositivo y se sincronizarán cuando vuelvas a conectarte.',
    },
    sync: {
      synced: 'Todo al día',
      syncing: 'Sincronizando…',
      pending:
        '{count, plural, one {# cambio pendiente de sincronizar} other {# cambios pendientes de sincronizar}}',
      pendingShort: '{count, plural, one {# pendiente} other {# pendientes}}',
      failed: 'Error al sincronizar',
      failedDescription:
        'No hemos podido conectar con el servidor. Tus cambios están a salvo en este dispositivo.',
      conflict: '{count, plural, one {# conflicto por revisar} other {# conflictos por revisar}}',
      conflictShort: '{count, plural, one {# conflicto} other {# conflictos}}',
      conflictDescription:
        'Este registro se modificó en otro dispositivo. Elige qué versión quieres conservar.',
      retrying: 'Reintentando…',
      authRequired: 'Inicia sesión para sincronizar',
      failedShort: '{count, plural, one {# sin enviar} other {# sin enviar}}',
      offlineShort:
        '{count, plural, =0 {Sin conexión} one {Sin conexión, # pendiente} other {Sin conexión, # pendientes}}',
    },
    approval: {
      title: 'Pendiente de aprobación',
      description:
        'Has iniciado sesión, pero el propietario aún no te ha dado acceso. Pídele que apruebe tu cuenta y vuelve a iniciar sesión.',
    },
    signInHelp:
      '¿Tienes problemas? Asegúrate de usar la cuenta de Google a la que te invitó el propietario y vuelve a intentarlo.',
    error: {
      title: 'Algo ha salido mal',
      description: 'Un error inesperado ha impedido cargar esta página. Vuelve a intentarlo.',
    },
    notFound: {
      title: 'Página no encontrada',
      description: 'La página que buscas no existe o se ha movido.',
    },
  },
  money: {
    negative: 'menos {amount}',
  },
  confirm: {
    typeToConfirm: 'Para confirmar, escribe {phrase} a continuación.',
    phraseLabel: 'Frase de confirmación',
  },
  signin: {
    title: 'Te damos la bienvenida a Spending',
    subtitle: 'Un lugar tranquilo para tus gastos personales y familiares.',
    continueWithGoogle: 'Continuar con Google',
    approvalNote:
      'Spending es privado. Después de iniciar sesión, el propietario tiene que aprobar tu cuenta para que puedas usarla.',
    errors: {
      login_failed: 'No se ha completado el inicio de sesión. Vuelve a intentarlo.',
      login_expired: 'El inicio de sesión ha tardado demasiado y ha caducado. Empieza de nuevo.',
      INVALID_ACCOUNT: 'Esta cuenta está archivada o no está disponible aquí. Elige otra.',
      INVALID_CATEGORY: 'Esta categoría está archivada o no encaja con este tipo. Elige otra.',
      REVIEW_REQUIRED:
        'Este registro espera revisión en una importación y aún no se puede cambiar.',
      MUTATION_ID_REUSED: 'No hemos podido asociar este cambio a tu cuenta. Vuelve a hacerlo.',
    },
    pendingHint: {
      title: '¿Sigues sin poder entrar?',
      description:
        'Si inicias sesión pero siempre vuelves aquí, puede que el propietario aún no haya aprobado tu cuenta o no te haya dado acceso a Spending. Pídeselo y vuelve a intentarlo.',
    },
  },
  signOut: {
    pendingTitle: '¿Cerrar sesión con cambios sin sincronizar?',
    pendingDescription:
      'Algunos cambios de este dispositivo aún no han llegado al servidor. Si cierras sesión, se borrarán de este dispositivo.',
    pendingConfirm: 'Cerrar sesión de todos modos',
  },
  userMenu: {
    label: 'Cuenta: {name}',
  },
  invite: {
    title: '¿Unirte a {family}?',
    description:
      '{owner} te invita a compartir los gastos familiares. Las entradas personales siguen siendo privadas.',
    validUntil: 'Este enlace funciona hasta el {date}.',
    accept: 'Unirme a {family}',
    notNow: 'Ahora no',
    joined: 'Bienvenido a {family}',
    invalidTitle: 'Esta invitación ya no es válida',
    invalidDescription:
      'El enlace puede haber caducado, haberse usado ya o haberse revocado. Pide al propietario de la familia uno nuevo.',
    alreadyTitle: 'Ya formas parte de una familia',
    alreadyDescription:
      'Solo se puede pertenecer a una familia a la vez. Sal de {family} antes de unirte a otra.',
    openFamily: 'Abrir mi familia',
  },
  pages: {
    dashboard: {
      title: 'Resumen',
      description: 'En qué se ha ido tu dinero este mes.',
      emptyTitle: 'Tu mes de un vistazo',
      emptyDescription:
        'Añade tu primer movimiento para ver aquí tus gastos, ingresos y presupuestos.',
    },
    transactions: {
      title: 'Movimientos',
      description: 'Todos tus gastos e ingresos, los más recientes primero.',
      emptyTitle: 'Aún no hay movimientos',
      emptyDescription: 'Añade un gasto o importa un extracto bancario para empezar.',
      searchLabel: 'Buscar movimientos',
      searchPlaceholder: 'Busca en descripciones y notas',
      kindFilter: 'Tipo',
      allKinds: 'Todos',
      noMatchesTitle: 'No hay movimientos que coincidan',
      noMatchesDescription: 'Prueba con otra búsqueda u otro tipo.',
      firstSync: 'Trayendo tu historial a este dispositivo…',
      firstSyncLoaded: '{count, plural, one {# registro por ahora} other {# registros por ahora}}',
      totalSpent: 'Gastado',
      totalReceived: 'Recibido',
      uncategorized: 'Sin categoría',
      pending: 'Pendiente de sincronizar',
      failed: 'Sin sincronizar: {reason}',
      conflict: 'Necesita revisión',
    },
    addTransaction: {
      title: 'Añadir movimiento',
      description: 'Registra un gasto o un ingreso.',
    },
    editTransaction: {
      title: 'Editar movimiento',
      description: 'Los cambios se guardan en este dispositivo y se sincronizan solos.',
      notFoundTitle: 'Movimiento no encontrado',
      notFoundDescription:
        'Puede que se haya eliminado o que aún no haya llegado a este dispositivo.',
    },
    budgets: {
      title: 'Presupuestos',
      description: 'Límites mensuales por categoría.',
      emptyTitle: 'Aún no hay presupuestos',
      emptyDescription:
        'Fija un límite mensual para una categoría y mantén tus gastos bajo control.',
    },
    recurring: {
      title: 'Pagos recurrentes',
      description: 'Suscripciones, alquiler y otros pagos periódicos.',
      emptyTitle: 'No hay pagos recurrentes',
      emptyDescription:
        'Añade un pago periódico y se registrará automáticamente según lo previsto.',
    },
    accounts: {
      title: 'Cuentas',
      description: 'Efectivo, tarjetas y cuentas bancarias.',
      emptyTitle: 'Aún no hay cuentas',
      emptyDescription: 'Añade una cuenta para seguir tus saldos en cualquier divisa.',
    },
    categories: {
      title: 'Categorías',
      description: 'Cómo se agrupan tus gastos.',
      emptyTitle: 'Aún no hay categorías',
      emptyDescription: 'Crea categorías para ver en qué se va tu dinero.',
    },
    imports: {
      title: 'Importaciones',
      description: 'Trae movimientos desde un extracto bancario.',
      emptyTitle: 'Aún no hay importaciones',
      emptyDescription: 'Sube un archivo CSV de tu banco para añadir muchos movimientos a la vez.',
    },
    family: {
      title: 'Familia',
      description: 'Comparte un espacio con las personas con las que vives.',
    },
    settings: {
      title: 'Ajustes',
      description: 'Tu perfil y tus preferencias.',
    },
    sync: {
      title: 'Sincronización',
      description: 'Cambios en este dispositivo y su estado.',
      emptyTitle: 'Todo está sincronizado',
      emptyDescription:
        'Los cambios que hagas sin conexión esperarán aquí hasta llegar al servidor.',
    },
  },
  transactionForm: {
    kind: 'Tipo',
    expense: 'Gasto',
    income: 'Ingreso',
    amount: 'Importe',
    amountInvalid: 'Introduce un importe mayor que cero, por ejemplo 12.50.',
    currency: 'Divisa',
    date: 'Fecha',
    account: 'Cuenta',
    noAccount: 'Sin cuenta',
    category: 'Categoría',
    noCategory: 'Sin categoría',
    description: 'Descripción',
    descriptionPlaceholder: '¿En qué fue?',
    save: 'Guardar',
    saveFailed: 'Este dispositivo no ha podido guardar el cambio. Inténtalo de nuevo.',
    delete: 'Eliminar',
    deleteTitle: '¿Eliminar este movimiento?',
    deleteDescription: 'Desaparece ya de tu historial y del servidor en la próxima sincronización.',
    notReady: 'Preparando tus cuentas y categorías…',
  },
  settings: {
    appearance: 'Apariencia',
    language: {
      label: 'Idioma',
      description: 'Se usa en menús, fechas y números.',
    },
    theme: {
      label: 'Tema',
      description: 'Igual que tu dispositivo o el que elijas.',
      light: 'Claro',
      dark: 'Oscuro',
      system: 'Sistema',
    },
    layout: {
      label: 'Diseño',
      description: 'Cómo se organiza la aplicación en este y en los demás dispositivos.',
      calm: 'Minimalista sereno',
      cards: 'Pila de tarjetas',
      soft: 'Suave y cercano',
      journal: 'Diario',
      bento: 'Bento',
      split: 'Vista dividida',
      playful: 'Desenfadado',
      hybrid: 'Híbrido',
    },
    palette: {
      label: 'Paleta de colores',
      description: 'Colores de acento y de fondo, en claro y oscuro.',
      emerald: 'Esmeralda',
      rose: 'Rosa',
      ocean: 'Océano',
      sand: 'Arena',
      graphite: 'Grafito',
    },
    timezone: {
      label: 'Zona horaria',
      description: 'Se usa en fechas, presupuestos y pagos periódicos.',
      suggested: 'Este dispositivo',
      all: 'Todas las zonas horarias',
    },
    account: 'Cuenta',
    signOutNote:
      'Al cerrar sesión, tus datos se borran de este dispositivo. En el servidor todo sigue a salvo.',
  },
  family: {
    create: {
      title: 'Crear un espacio familiar',
      description:
        'Los gastos compartidos viven en la familia. Tus entradas personales siguen siendo tuyas, y cada entrada nueva pregunta a cuál pertenece.',
      nameLabel: 'Nombre de la familia',
      namePlaceholder: 'Los García',
      submit: 'Crear familia',
      created: 'Familia creada',
    },
    roles: {
      owner: 'Propietario',
      member: 'Miembro',
    },
    you: 'tú',
    members: {
      title: 'Miembros',
      count: '{count, plural, one {# miembro} other {# miembros}}',
      joined: 'Se unió el {date}',
    },
    invitations: {
      title: 'Invitaciones',
      description:
        'Cada enlace funciona una sola vez y se muestra una sola vez. Compártelo como prefieras.',
      expiry: 'Enlace válido durante',
      days: '{count, plural, one {# día} other {# días}}',
      create: 'Crear enlace de invitación',
      linkLabel: 'Enlace de invitación',
      copy: 'Copiar enlace',
      copied: 'Enlace copiado',
      copyFailed: 'Aquí no se puede copiar automáticamente. Selecciona el enlace y cópialo tú.',
      empty: 'Todavía no hay enlaces de invitación.',
      revoke: 'Revocar',
      revoked: 'Invitación revocada',
      state: {
        pending: 'Pendiente',
        accepted: 'Aceptada',
        revoked: 'Revocada',
        expired: 'Caducada',
      },
      expires: 'Caduca el {date}',
      acceptedBy: 'Aceptada por {name}',
      createdOn: 'Creada el {date}',
    },
    scope: {
      label: 'Para quién es',
      personal: 'Personal',
      family: 'Familia',
    },
    author: {
      paidBy: 'Pagado por {name}',
      formerMember: 'Antiguo miembro',
    },
  },
  errors: {
    AUTH_REQUIRED: 'Inicia sesión para continuar.',
    SESSION_REVOKED: 'Se ha cerrado tu sesión. Vuelve a iniciar sesión.',
    CSRF_FAILED: 'Tu sesión necesita actualizarse. Recarga la página y vuelve a intentarlo.',
    FORBIDDEN: 'No tienes acceso a esto.',
    NOT_FOUND: 'No hemos encontrado lo que buscabas.',
    VALIDATION_FAILED: 'Algunos datos no son válidos. Revisa los campos marcados.',
    CONFLICT: 'Esto se ha modificado en otro lugar. Revisa la versión más reciente.',
    RATE_LIMITED: 'Demasiados intentos. Espera un momento y vuelve a intentarlo.',
    PAYLOAD_TOO_LARGE: 'El archivo es demasiado grande para subirlo.',
    UNAVAILABLE: 'El servicio no está disponible temporalmente. Inténtalo de nuevo en breve.',
    CONFIRMATION_MISMATCH: 'El nombre que escribiste no coincide.',
    FAMILY_EXISTS: 'Ya formas parte de una familia.',
    OWNER_CANNOT_LEAVE:
      'El propietario no puede salir. Transfiere la propiedad o elimina la familia.',
    FAMILY_OWNER_MUST_TRANSFER: 'Primero transfiere la propiedad o elimina la familia.',
    INVITATION_INVALID: 'Esta invitación ya no es válida.',
    INTERNAL: 'Algo ha fallado por nuestra parte. Inténtalo de nuevo en un momento.',
    NETWORK:
      'Sin conexión con el servidor. Comprueba tu conexión a internet y vuelve a intentarlo.',
  },
} satisfies Messages;
