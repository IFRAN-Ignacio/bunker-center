'use strict';
/**
 * DATOS PROPIOS DE ESTE GIMNASIO.
 * Es lo único (junto con el front) que cambia entre un gym y otro: el motor del servidor es el mismo.
 * Todo esto se puede editar después desde el panel de administración.
 *
 * Horarios: 'HH:MM-HH:MM' o 'HH:MM-HH:MM@cupo' para un cupo distinto al de la actividad.
 * Días: 0 = domingo, 1 = lunes … 6 = sábado.
 */
const CLASS_LMV = ['07:00-08:00', '08:00-09:00', '09:00-10:00', '12:30-13:30', '13:30-14:30', '14:30-15:30', '17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00'];
const CLASS_MJ = ['07:00-08:00', '08:00-09:00', '09:00-10:00', '12:30-13:30', '13:30-14:30', '16:30-17:30', '17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00'];
const SAB = ['09:00-10:00', '10:00-11:00', '11:00-12:00'];
const OPEN = ['10:00-12:30', '15:30-17:00@12'];

module.exports = {
    site: { id: 'bunker', name: 'Bunker' },

    settings: {
        address: 'Av. Juan José Paso 3255, Mar del Plata',
        phone: '223 5282837',
        whatsapp: '5492235282837',
        instagram: 'bunker.gym',
        facebook_url: 'https://facebook.com',
        contact_email: '',
        // Datos para transferir: son DE PRUEBA (falsos) para simular. Los reales se cargan
        // desde Admin -> Configuración (Alias, CBU/CVU y Titular), sin tocar código.
        transfer_alias: 'BUNKER.PRUEBA.MDP',
        transfer_cbu: '0000000000000000000000',
        transfer_holder: 'Bunker Center (DATOS DE PRUEBA)',
        require_plan_to_reserve: '1',
        booking_days_ahead: '14',
        cancel_min_hours: '2',
        schedule_note: 'Las clases de Entrenamiento Híbrido arrancan en punto · Open Box con horario libre.',
    },

    openingHours: { 0: null, 1: ['07:00', '21:00'], 2: ['07:00', '21:00'], 3: ['07:00', '21:00'], 4: ['07:00', '21:00'], 5: ['07:00', '21:00'], 6: ['09:00', '12:00'] },

    activities: [
        { slug: 'crossfit', name: 'Crossfit', short_name: 'Crossfit', color: '#9d4edd', icon: 'pesa', capacity: 12,
          description: 'Mejorá tu fuerza, resistencia y potencia con entrenamientos variados y de alta intensidad.',
          schedule: { 1: CLASS_LMV, 3: CLASS_LMV, 5: CLASS_LMV } },
        { slug: 'funcional', name: 'Entrenamiento Funcional', short_name: 'Funcional', color: '#60a5fa', icon: 'pulso', capacity: 12,
          description: 'Movimientos naturales para mejorar tu vida diaria y prevenir lesiones.',
          schedule: { 1: CLASS_LMV, 3: CLASS_LMV, 5: CLASS_LMV } },
        { slug: 'hibrido', name: 'Entrenamiento Híbrido', short_name: 'Híbrido', color: '#c77dff', icon: 'rayo', capacity: 12,
          description: 'Lo mejor de la fuerza y la resistencia en una sola clase. ¡Arrancan en punto!',
          schedule: { 2: CLASS_MJ, 4: CLASS_MJ, 6: SAB } },
        { slug: 'open-box', name: 'Open Box', short_name: 'Open Box', color: '#94a3b8', icon: 'reloj', capacity: 10,
          description: 'Entrená a tu ritmo con horario libre y supervisión de nuestros coaches.',
          schedule: { 1: OPEN, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: SAB } },
    ],

    // activity: slug de la actividad (solo para kind 'actividad')
    plans: [
        { name: 'Pase libre', description: 'Todas las clases y Open Box, sin límite semanal.', kind: 'membresia', price: 45000, featured: true },
        { name: '3 veces por semana', description: 'Cualquier clase, hasta 3 por semana.', kind: 'membresia', price: 38000, weekly_limit: 3 },
        { name: '2 veces por semana', description: 'Cualquier clase, hasta 2 por semana.', kind: 'membresia', price: 32000, weekly_limit: 2 },
        { name: 'Solo Crossfit', description: 'Clases de Crossfit sin límite semanal.', kind: 'actividad', activity: 'crossfit', price: 36000 },
        { name: 'Solo Open Box', description: 'Entrená a tu ritmo en los horarios de Open Box.', kind: 'actividad', activity: 'open-box', price: 28000 },
        { name: 'Pase diario', description: 'Una clase suelta para probar el box.', kind: 'membresia', price: 8000, duration_days: 1, weekly_limit: 1 },
    ],
    demoPlan: 'Pase libre',

    // [nombre, descripción, categoría, precio, disponible]
    products: [
        ['Agua mineral 500 ml', 'Fría, en la heladera del box.', 'Bebidas', 1500, 1],
        ['Bebida isotónica 500 ml', 'Varios sabores.', 'Bebidas', 2500, 1],
        ['Barra de proteína', '20 g de proteína. Chocolate o frutilla.', 'Snacks', 2800, 1],
        ['Proteína whey 1 kg', 'Consultá sabores disponibles en recepción.', 'Suplementos', 38000, 1],
        ['Creatina monohidrato 300 g', 'Sin sabor.', 'Suplementos', 25000, 0],
        ['Remera Bunker', 'Algodón, talles S a XXL.', 'Indumentaria', 18000, 1],
        ['Shaker Bunker 600 ml', 'Con compartimento para polvo.', 'Accesorios', 7000, 1],
        ['Muñequeras', 'Par, ajuste con abrojo.', 'Accesorios', 9000, 1],
    ],

    // Conocimiento EXTRA del asistente (lo que no está en ninguna pantalla pero cualquier gym sabe).
    // Se copia a knowledge/extras_gym.csv la primera vez; después se edita desde el panel (pestaña Asistente).
    // [tema, dato]
    extras: [
        ['Experiencia previa', 'No hace falta experiencia. Todas las clases se adaptan a tu nivel y los coaches te acompañan desde el primer día. Si nunca entrenaste, conviene arrancar con Entrenamiento Funcional.'],
        ['Qué llevar', 'Ropa cómoda, zapatillas de entrenamiento con buena suela, toalla chica y botella de agua. Si te olvidás algo, en el mostrador del box hay agua, bebidas y accesorios.'],
        ['Toalla', 'Traé siempre una toalla chica: es para secarte y para apoyarla en los bancos y colchonetas. Es una cuestión de higiene.'],
        ['Hidratación', 'Traé tu botella de agua y tomá de a poco durante la clase. En el mostrador se venden agua e isotónicas.'],
        ['Comer antes de entrenar', 'Lo ideal es comer algo liviano una o dos horas antes. No conviene venir en ayunas a una clase intensa ni con el estómago muy lleno.'],
        ['Llegar antes', 'Llegá unos 10 minutos antes, sobre todo la primera vez, para cambiarte, entrar en calor y que el coach te conozca. Las clases de Entrenamiento Híbrido arrancan en punto.'],
        ['Lesiones o problemas de salud', 'Si tenés una lesión, estás embarazada o tenés algún problema de salud, avisale al coach antes de la clase y consultá con tu médico. El asistente no da consejos médicos.'],
        ['Apto médico', 'Te recomendamos hacerte un chequeo médico antes de empezar a entrenar. Para saber si el box lo pide, consultá en recepción.'],
        ['Vestuarios', 'Hay vestuarios para cambiarte antes y después de entrenar. No dejes objetos de valor sin cuidar.'],
        ['Cuidado del material', 'Al terminar, ordená y limpiá el material que usaste (pesas, colchonetas, barras). Así el box queda listo para la siguiente clase.'],
        ['Clase de prueba', 'Para probar el box está el Pase diario: una clase suelta antes de elegir un plan mensual.'],
        ['Cómo reservar', 'Creá tu cuenta, contratá un plan y entrá a "Reservar clase": elegís la disciplina, el día, el horario y tu boleto (tu lugar en la clase).'],
        ['Cancelar una reserva', 'Se cancela desde "Mis reservas", respetando las horas mínimas de anticipación, para que el lugar le quede a otra persona.'],
        ['Profes', 'Cada clase tiene profes asignados. Si un profe avisa que no puede venir, al reservar vas a ver "Falta 1 profe" o "Sin profe" en ese horario.'],
    ],
};
